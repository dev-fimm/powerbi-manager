import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { ActiveBadge, PageHeader, RoleBadge } from '../components/ui/Card';
import { Checkbox, Input, Select } from '../components/ui/Field';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { Table, type Column } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { Contract, Role, User } from '../types';

interface FormState {
  name: string;
  email: string;
  password: string;
  role: Role;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  password: '',
  role: 'VISUALIZADOR',
  isActive: true,
};

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<User[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Modal de associacao de contratos
  const [linking, setLinking] = useState<User | null>(null);
  const [selectedContracts, setSelectedContracts] = useState<string[]>([]);
  const [linkSaving, setLinkSaving] = useState(false);

  const [deleting, setDeleting] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, contractList] = await Promise.all([
        api.get<User[]>('/users'),
        api.get<Contract[]>('/contracts'),
      ]);
      setUsers(userList);
      setContracts(contractList);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar usuarios.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(user: User) {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      password: '', // vazio = mantem a senha atual
      role: user.role,
      isActive: user.is_active,
    });
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/users/${editing.id}`, {
          name: form.name,
          email: form.email,
          role: form.role,
          isActive: form.isActive,
          // So envia a senha se o admin digitou uma nova.
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success('Usuario atualizado.');
      } else {
        await api.post('/users', {
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          isActive: form.isActive,
        });
        toast.success('Usuario criado.');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar o usuario.');
    } finally {
      setSaving(false);
    }
  }

  function openLinkModal(user: User) {
    setLinking(user);
    setSelectedContracts(user.contracts?.map((c) => c.id) ?? []);
  }

  async function handleSaveLinks() {
    if (!linking) return;
    setLinkSaving(true);
    try {
      await api.put(`/users/${linking.id}/contracts`, { contract_ids: selectedContracts });
      toast.success('Contratos associados atualizados.');
      setLinking(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao associar contratos.');
    } finally {
      setLinkSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/users/${deleting.id}`);
      toast.success('Usuario excluido. Os contratos foram preservados.');
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir o usuario.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Usuario',
      render: (u) => (
        <div>
          <p className="font-medium text-slate-800">
            {u.name}
            {u.id === currentUser?.id && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">voce</span>
            )}
          </p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Perfil', render: (u) => <RoleBadge role={u.role} /> },
    {
      key: 'contracts',
      header: 'Contratos',
      render: (u) =>
        u.role === 'ADMIN' ? (
          <span className="text-xs text-slate-500">Todos (ADMIN)</span>
        ) : (
          <span className="tabular-nums text-slate-600">{u.contracts?.length ?? 0}</span>
        ),
    },
    { key: 'status', header: 'Status', render: (u) => <ActiveBadge active={u.is_active} /> },
    {
      key: 'created',
      header: 'Criado em',
      render: (u) => <span className="whitespace-nowrap text-slate-600">{formatDate(u.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Acoes',
      className: 'text-right',
      render: (u) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => openLinkModal(u)} disabled={u.role === 'ADMIN'}>
            Contratos
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
            Editar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-600 hover:bg-rose-50"
            onClick={() => setDeleting(u)}
            disabled={u.id === currentUser?.id}
          >
            Excluir
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Cadastre os usuarios e defina a quais contratos cada um tem acesso."
        action={<Button onClick={openCreate}>Novo usuario</Button>}
      />

      <Table
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        loading={loading}
        emptyMessage="Nenhum usuario cadastrado."
      />

      {/* ---------------------------------------------- Modal de cadastro */}
      <Modal
        open={modalOpen}
        title={editing ? 'Editar usuario' : 'Novo usuario'}
        subtitle={editing?.email}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button form="user-form" type="submit" loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nome"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="E-mail"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label={editing ? 'Nova senha' : 'Senha'}
            type="password"
            required={!editing}
            minLength={6}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            hint={editing ? 'Deixe em branco para manter a senha atual.' : 'Minimo de 6 caracteres.'}
          />
          <Select
            label="Perfil de acesso"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            disabled={editing?.id === currentUser?.id}
            hint={
              form.role === 'ADMIN'
                ? 'Acesso total a todos os contratos e usuarios.'
                : form.role === 'GESTOR'
                  ? 'Gerencia contratos e iframes dos contratos associados.'
                  : 'Apenas visualiza os paineis dos contratos associados.'
            }
          >
            <option value="ADMIN">Administrador</option>
            <option value="GESTOR">Gestor</option>
            <option value="VISUALIZADOR">Visualizador</option>
          </Select>
          <div className="sm:col-span-2">
            <Checkbox
              label="Usuario ativo"
              checked={form.isActive}
              disabled={editing?.id === currentUser?.id}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
          </div>
        </form>
      </Modal>

      {/* ---------------------------------------------- Modal de contratos */}
      <Modal
        open={Boolean(linking)}
        title="Contratos do usuario"
        subtitle={linking ? `${linking.name} (${linking.email})` : undefined}
        onClose={() => setLinking(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLinking(null)} disabled={linkSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveLinks} loading={linkSaving}>
              Salvar associacoes
            </Button>
          </>
        }
      >
        {contracts.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum contrato cadastrado ainda.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {contracts.map((contract) => {
              const checked = selectedContracts.includes(contract.id);
              return (
                <label
                  key={contract.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    checked ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedContracts((prev) =>
                        e.target.checked
                          ? [...prev, contract.id]
                          : prev.filter((id) => id !== contract.id),
                      )
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{contract.name}</p>
                    <p className="text-xs text-slate-500">
                      {contract.client_name} &middot; {contract.iframes_count ?? 0} painel(is)
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Excluir usuario"
        message={`Excluir "${deleting?.name}" remove apenas as associacoes de contratos deste usuario. Nenhum contrato sera excluido.`}
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
