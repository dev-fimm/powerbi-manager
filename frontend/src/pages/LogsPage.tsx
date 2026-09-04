import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/Card';
import { Input, Select } from '../components/ui/Field';
import { Table, type Column } from '../components/ui/Table';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import { LOG_ACTION_LABEL, LOG_ACTION_TONE, formatDateTime, type LogTone } from '../lib/format';
import type { AuditLog, Paginated, User } from '../types';

const TONE_STYLES: Record<LogTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  rose: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

function ActionBadge({ action }: { action: string }) {
  const tone = LOG_ACTION_TONE[action] ?? 'slate';
  const label = LOG_ACTION_LABEL[action] ?? action;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_STYLES[tone]}`}
    >
      {label}
    </span>
  );
}

interface Filters {
  action: string;
  userId: string;
  search: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { action: '', userId: '', search: '', from: '', to: '' };

const PAGE_SIZE = 20;

export function LogsPage() {
  const toast = useToast();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filtros aplicados (o que esta em vigor na busca atual).
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  // Filtros do formulario (o que o usuario esta digitando/selecionando).
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);

  // Carrega a lista de usuarios uma vez, para o filtro por autor.
  useEffect(() => {
    api
      .get<User[]>('/users')
      .then(setUsers)
      .catch(() => {
        /* filtro por usuario e opcional; ignora falha silenciosamente */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(PAGE_SIZE));
      if (applied.action) params.set('action', applied.action);
      if (applied.userId) params.set('user_id', applied.userId);
      if (applied.search) params.set('search', applied.search);
      if (applied.from) params.set('from', applied.from);
      if (applied.to) params.set('to', applied.to);

      const res = await api.get<Paginated<AuditLog>>(`/logs?${params.toString()}`);
      setLogs(res.data);
      setTotal(res.total);
      setTotalPages(res.total_pages);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar os logs.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, applied]);

  useEffect(() => {
    load();
  }, [load]);

  function handleFilter(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setApplied(draft);
  }

  function handleReset() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  const hasFilters = useMemo(
    () => Object.values(applied).some((v) => v !== ''),
    [applied],
  );

  const columns: Column<AuditLog>[] = [
    {
      key: 'created',
      header: 'Data/Hora',
      render: (log) => (
        <span className="whitespace-nowrap tabular-nums text-slate-600">
          {formatDateTime(log.created_at)}
        </span>
      ),
    },
    {
      key: 'user',
      header: 'Usuario',
      render: (log) =>
        log.user_name || log.user_email ? (
          <div>
            <p className="font-medium text-slate-800">{log.user_name ?? '-'}</p>
            <p className="text-xs text-slate-500">{log.user_email}</p>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Sistema / anonimo</span>
        ),
    },
    { key: 'action', header: 'Acao', render: (log) => <ActionBadge action={log.action} /> },
    {
      key: 'description',
      header: 'Detalhes',
      render: (log) => (
        <span className="text-slate-600">{log.description ?? '-'}</span>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      render: (log) => (
        <span className="whitespace-nowrap font-mono text-xs text-slate-500">
          {log.ip_address ?? '-'}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Logs de auditoria"
        description="Acompanhe as acoes dos usuarios: logins, logouts e alteracoes em usuarios, contratos e iframes."
      />

      {/* -------------------------------------------------- Filtros */}
      <form
        onSubmit={handleFilter}
        className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6"
      >
        <div className="lg:col-span-2">
          <Input
            label="Buscar"
            placeholder="Nome, e-mail ou detalhe..."
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
          />
        </div>
        <Select
          label="Acao"
          value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value })}
        >
          <option value="">Todas</option>
          {Object.entries(LOG_ACTION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label="Usuario"
          value={draft.userId}
          onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
        >
          <option value="">Todos</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Input
          label="De"
          type="date"
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <Input
          label="Ate"
          type="date"
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">Filtrar</Button>
          {hasFilters && (
            <Button type="button" variant="secondary" onClick={handleReset}>
              Limpar
            </Button>
          )}
        </div>
      </form>

      <Table
        columns={columns}
        rows={logs}
        rowKey={(log) => log.id}
        loading={loading}
        emptyMessage="Nenhum log encontrado para os filtros selecionados."
      />

      {/* -------------------------------------------------- Paginacao */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <span>
          {total === 0
            ? 'Nenhum registro'
            : `${total} registro(s) - pagina ${page} de ${totalPages}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Proxima
          </Button>
        </div>
      </div>
    </div>
  );
}
