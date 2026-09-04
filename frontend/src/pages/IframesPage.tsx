import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ActiveBadge, PageHeader } from '../components/ui/Card';
import { Checkbox, Input, Select, Textarea } from '../components/ui/Field';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { Table, type Column } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import type { Contract, Iframe } from '../types';

/**
 * ============================================================
 * VALIDACAO VISUAL DA URL DO POWER BI
 * ============================================================
 * Espelha a regra do backend (regra 4). O backend continua sendo a fonte
 * da verdade; isto aqui serve para dar feedback imediato ao usuario.
 */
export function isValidPowerBiUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return false;
    if (url.hostname.toLowerCase() !== 'app.powerbi.com') return false;
    const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    return path === '/view' || path === '/reportembed';
  } catch {
    return false;
  }
}

interface FormState {
  title: string;
  power_bi_url: string;
  description: string;
  contract_id: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  title: '',
  power_bi_url: '',
  description: '',
  contract_id: '',
  is_active: true,
};

export function IframesPage() {
  const { canManage } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const contractFilter = searchParams.get('contract') ?? '';

  const [iframes, setIframes] = useState<Iframe[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Iframe | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<Iframe | null>(null);
  const [deleting, setDeleting] = useState<Iframe | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const urlTouched = form.power_bi_url.length > 0;
  const urlValid = useMemo(() => isValidPowerBiUrl(form.power_bi_url), [form.power_bi_url]);

  useEffect(() => {
    api
      .get<Contract[]>('/contracts')
      .then(setContracts)
      .catch(() => toast.error('Nao foi possivel carregar a lista de contratos.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = contractFilter ? `?contract_id=${contractFilter}` : '';
      setIframes(await api.get<Iframe[]>(`/iframes${query}`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar iframes.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, contract_id: contractFilter || contracts[0]?.id || '' });
    setModalOpen(true);
  }

  function openEdit(iframe: Iframe) {
    setEditing(iframe);
    setForm({
      title: iframe.title,
      power_bi_url: iframe.power_bi_url,
      description: iframe.description ?? '',
      contract_id: iframe.contract_id,
      is_active: iframe.is_active,
    });
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!urlValid) {
      toast.error('Informe uma URL publica valida do Power BI.');
      return;
    }
    if (!form.contract_id) {
      toast.error('Selecione o contrato ao qual este iframe pertence.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: form.title,
        power_bi_url: form.power_bi_url.trim(),
        description: form.description || null,
        contract_id: form.contract_id,
        is_active: form.is_active,
      };

      if (editing) {
        await api.put(`/iframes/${editing.id}`, payload);
        toast.success('Iframe atualizado.');
      } else {
        await api.post('/iframes', payload);
        toast.success('Iframe criado.');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar o iframe.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(iframe: Iframe) {
    try {
      await api.put(`/iframes/${iframe.id}`, { is_active: !iframe.is_active });
      toast.success(iframe.is_active ? 'Iframe desativado.' : 'Iframe ativado.');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao alterar o status.');
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/iframes/${deleting.id}`);
      toast.success('Iframe excluido.');
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir o iframe.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const contractName = (id: string) => contracts.find((c) => c.id === id)?.name ?? '-';

  const columns: Column<Iframe>[] = [
    {
      key: 'title',
      header: 'Painel',
      render: (i) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{i.title}</p>
          <p className="mt-0.5 max-w-md truncate font-mono text-xs text-slate-400">{i.power_bi_url}</p>
        </div>
      ),
    },
    {
      key: 'contract',
      header: 'Contrato',
      render: (i) => <span className="text-slate-600">{i.contract?.name ?? contractName(i.contract_id)}</span>,
    },
    { key: 'status', header: 'Status', render: (i) => <ActiveBadge active={i.is_active} /> },
    {
      key: 'actions',
      header: 'Acoes',
      className: 'text-right',
      render: (i) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setPreview(i)}>
            Preview
          </Button>
          {canManage && (
            <>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(i)}>
                {i.is_active ? 'Desativar' : 'Ativar'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openEdit(i)}>
                Editar
              </Button>
              <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => setDeleting(i)}>
                Excluir
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Iframes"
        description="Cadastre os relatorios e dashboards publicos do Power BI de cada contrato."
        action={
          canManage ? (
            <Button onClick={openCreate} disabled={contracts.length === 0}>
              Novo iframe
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 w-full sm:w-80">
        <Select
          value={contractFilter}
          onChange={(e) => {
            const value = e.target.value;
            setSearchParams(value ? { contract: value } : {});
          }}
        >
          <option value="">Todos os contratos</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <Table
        columns={columns}
        rows={iframes}
        rowKey={(i) => i.id}
        loading={loading}
        emptyMessage="Nenhum iframe cadastrado para este filtro."
      />

      {/* ---------------------------------------------- Modal de cadastro */}
      <Modal
        open={modalOpen}
        title={editing ? 'Editar iframe' : 'Novo iframe'}
        subtitle="Todo iframe pertence obrigatoriamente a um contrato."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button form="iframe-form" type="submit" loading={saving} disabled={!urlValid}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="iframe-form" onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Titulo"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ex.: Painel Operacional - Producao Diaria"
          />

          <Select
            label="Contrato"
            required
            value={form.contract_id}
            onChange={(e) => setForm({ ...form, contract_id: e.target.value })}
          >
            <option value="">Selecione um contrato</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} - {c.client_name}
              </option>
            ))}
          </Select>

          {/* Campo de URL com validacao visual em tempo real. */}
          <div>
            <label className="label-base">
              URL publica do Power BI <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                required
                value={form.power_bi_url}
                onChange={(e) => setForm({ ...form, power_bi_url: e.target.value })}
                placeholder="https://app.powerbi.com/view?r=..."
                className={`input-base pr-10 font-mono text-xs ${
                  urlTouched
                    ? urlValid
                      ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20'
                      : 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
                    : ''
                }`}
              />
              {urlTouched && (
                <span className="absolute right-3 top-2.5">
                  {urlValid ? (
                    <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </span>
              )}
            </div>
            {urlTouched && !urlValid ? (
              <p className="mt-1 text-xs font-medium text-rose-600">
                A URL deve comecar com https://app.powerbi.com/view ou
                https://app.powerbi.com/reportEmbed
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                No Power BI: Arquivo &rarr; Inserir relatorio &rarr; Publicar na web (publico) e copie
                o link do iframe.
              </p>
            )}
          </div>

          <Textarea
            label="Descricao"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Opcional. Aparece acima do painel na tela Paineis."
          />

          <Checkbox
            label="Iframe ativo (visivel na tela Paineis)"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
        </form>
      </Modal>

      {/* ---------------------------------------------- Preview */}
      <Modal
        open={Boolean(preview)}
        title={preview?.title ?? ''}
        subtitle={preview?.description ?? undefined}
        onClose={() => setPreview(null)}
        width="lg"
      >
        {preview && (
          <iframe
            title={preview.title}
            src={preview.power_bi_url}
            className="h-[600px] w-full rounded-lg border border-slate-200"
            frameBorder={0}
            allowFullScreen
            /* Nao vaza a URL desta tela para o Power BI. */
            referrerPolicy="no-referrer"
            /* Mesmo confinamento do viewer - ver comentario em ViewerPage.tsx. */
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Excluir iframe"
        message={`Tem certeza que deseja excluir "${deleting?.title}"? Esta acao nao pode ser desfeita.`}
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
