import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { PageHeader, StatusBadge } from '../components/ui/Card';
import { Input, Select, Textarea } from '../components/ui/Field';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { Table, type Column } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import { formatDate, toDateInput } from '../lib/format';
import type { Contract, ContractStatus } from '../types';

interface FormState {
  name: string;
  client_name: string;
  description: string;
  start_date: string;
  end_date: string;
  status: ContractStatus;
}

const EMPTY_FORM: FormState = {
  name: '',
  client_name: '',
  description: '',
  start_date: '',
  end_date: '',
  status: 'ATIVO',
};

export function ContractsPage() {
  const { hasFullAccess, canManage } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | ContractStatus>('');
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<Contract | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const query = params.toString();
      setContracts(await api.get<Contract[]>(`/contracts${query ? `?${query}` : ''}`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar contratos.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  // Debounce simples na busca para nao disparar uma request por tecla.
  useEffect(() => {
    const id = window.setTimeout(load, search ? 350 : 0);
    return () => window.clearTimeout(id);
  }, [load, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(contract: Contract) {
    setEditing(contract);
    setForm({
      name: contract.name,
      client_name: contract.client_name,
      description: contract.description ?? '',
      start_date: toDateInput(contract.start_date),
      end_date: toDateInput(contract.end_date),
      status: contract.status,
    });
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        client_name: form.client_name,
        description: form.description || null,
        start_date: form.start_date,
        end_date: form.end_date,
        status: form.status,
      };

      if (editing) {
        await api.put(`/contracts/${editing.id}`, payload);
        toast.success('Contrato atualizado.');
      } else {
        await api.post('/contracts', payload);
        toast.success('Contrato criado.');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar o contrato.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/contracts/${deleting.id}`);
      toast.success('Contrato excluido junto com seus iframes.');
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir o contrato.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const columns: Column<Contract>[] = [
    {
      key: 'name',
      header: 'Contrato',
      render: (c) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{c.name}</p>
          {c.description && (
            <p className="mt-0.5 max-w-md truncate text-xs text-slate-500">{c.description}</p>
          )}
        </div>
      ),
    },
    { key: 'client', header: 'Cliente', render: (c) => <span className="text-slate-600">{c.client_name}</span> },
    {
      key: 'period',
      header: 'Vigencia',
      render: (c) => (
        <span className="whitespace-nowrap text-slate-600">
          {formatDate(c.start_date)} - {formatDate(c.end_date)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'iframes',
      header: 'Paineis',
      render: (c) => <span className="tabular-nums text-slate-600">{c.iframes_count ?? 0}</span>,
    },
    {
      key: 'actions',
      header: 'Acoes',
      className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/iframes?contract=${c.id}`)}>
            Ver iframes
          </Button>
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
              Editar
            </Button>
          )}
          {/* Excluir contrato: apenas ADMIN/DESENVOLVEDOR (regra 2). */}
          {hasFullAccess && (
            <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => setDeleting(c)}>
              Excluir
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Contratos"
        description="Gerencie os contratos e acesse os paineis vinculados a cada um."
        action={canManage ? <Button onClick={openCreate}>Novo contrato</Button> : undefined}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-full sm:w-72">
          <Input
            placeholder="Buscar por nome ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | ContractStatus)}>
            <option value="">Todos os status</option>
            <option value="ATIVO">Ativo</option>
            <option value="SUSPENSO">Suspenso</option>
            <option value="ENCERRADO">Encerrado</option>
          </Select>
        </div>
      </div>

      <Table
        columns={columns}
        rows={contracts}
        rowKey={(c) => c.id}
        loading={loading}
        emptyMessage="Nenhum contrato encontrado para os filtros atuais."
      />

      <Modal
        open={modalOpen}
        title={editing ? 'Editar contrato' : 'Novo contrato'}
        subtitle={editing ? editing.name : 'Preencha os dados do contrato'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button form="contract-form" type="submit" loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="contract-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nome do contrato"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Cliente"
            required
            value={form.client_name}
            onChange={(e) => setForm({ ...form, client_name: e.target.value })}
          />
          <Input
            label="Inicio da vigencia"
            type="date"
            required
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
          <Input
            label="Fim da vigencia"
            type="date"
            required
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ContractStatus })}
            hint="Contratos ENCERRADOS ficam ocultos na tela Paineis."
          >
            <option value="ATIVO">Ativo</option>
            <option value="SUSPENSO">Suspenso</option>
            <option value="ENCERRADO">Encerrado</option>
          </Select>
          <div className="sm:col-span-2">
            <Textarea
              label="Descricao"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Opcional"
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Excluir contrato"
        message={`Excluir "${deleting?.name}" tambem removera TODOS os iframes vinculados a ele e as associacoes de usuarios. Esta acao nao pode ser desfeita.`}
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
