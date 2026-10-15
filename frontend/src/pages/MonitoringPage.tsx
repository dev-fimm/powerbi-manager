import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, PageHeader, RoleBadge, StatCard } from '../components/ui/Card';
import { Input, Select } from '../components/ui/Field';
import { PaginatedTable } from '../components/ui/PaginatedTable';
import { type Column } from '../components/ui/Table';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import {
  AXIS_COLOR,
  CATEGORICAL,
  GRID_COLOR,
  WEEKDAY_LABELS,
  formatDateTime,
  formatDuration,
  formatPeriod,
  formatRelative,
  sequentialStep,
} from '../lib/charts';
import type { MonitoringOverview, User } from '../types';

/** Tinta de texto dos graficos: nunca a cor da serie (ver lib/charts.ts). */
const INK = '#334155';
const INK_MUTED = '#64748b';

const icon = (d: string) => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const ICONS = {
  sessions: 'M11 7H6a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  views: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
};

/** yyyy-mm-dd de hoje menos N dias, no fuso local. */
function dayInput(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Tooltip comum a todos os graficos. Os valores aparecem em tinta de texto,
 * com um quadrado da cor da serie ao lado carregando a identidade.
 */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-700">{label}</p>
      {payload.map((item) => (
        <p key={item.name} className="flex items-center gap-2 text-slate-600">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.name}:</span>
          <span className="font-semibold tabular-nums text-slate-800">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Barra inline para dar leitura de proporcao dentro da tabela. */
function InlineBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums text-slate-700">{value}</span>
    </div>
  );
}

export function MonitoringPage() {
  const toast = useToast();

  const [from, setFrom] = useState(() => dayInput(29));
  const [to, setTo] = useState(() => dayInput(0));
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [inactiveDays, setInactiveDays] = useState(30);
  const [userId, setUserId] = useState('');

  const [users, setUsers] = useState<User[]>([]);

  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // Lista de contas para o filtro. Carregada uma vez: nao depende do periodo.
  useEffect(() => {
    api
      .get<User[]>('/users')
      .then(setUsers)
      .catch(() => {
        /* o filtro por conta e opcional; sem a lista a tela segue funcionando */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        from,
        to,
        granularity,
        inactive_days: String(inactiveDays),
      });
      if (userId) query.set('user_id', userId);
      setData(await api.get<MonitoringOverview>(`/monitoring/overview?${query}`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar o monitoramento.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, granularity, inactiveDays, userId]);

  useEffect(() => {
    load();
  }, [load]);

  // ------------------------------------------------------------- series
  const timeline = useMemo(
    () =>
      (data?.timeline ?? []).map((p) => ({
        label: formatPeriod(p.period, granularity),
        Sessoes: p.sessions,
        'Paineis vistos': p.iframe_views,
      })),
    [data, granularity],
  );

  const topIframeRows = useMemo(
    () =>
      (data?.top_iframes ?? []).slice(0, 10).map((i) => ({
        label: i.title.length > 28 ? `${i.title.slice(0, 27)}...` : i.title,
        Acessos: i.views,
      })),
    [data],
  );

  const heatmapMax = useMemo(
    () => Math.max(0, ...(data?.heatmap ?? []).flat()),
    [data],
  );

  const maxUserSessions = Math.max(1, ...(data?.by_user ?? []).map((u) => u.sessions));
  const maxContractViews = Math.max(1, ...(data?.by_contract ?? []).map((c) => c.iframe_views));

  // ------------------------------------------------------------- colunas
  const userColumns: Column<MonitoringOverview['by_user'][number]>[] = [
    {
      key: 'user',
      header: 'Usuario',
      render: (u) => (
        <div>
          <p className="font-medium text-slate-800">{u.name}</p>
          <p className="text-xs text-slate-500">{u.email ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Perfil',
      render: (u) => (u.role ? <RoleBadge role={u.role} /> : <span className="text-slate-400">—</span>),
    },
    {
      key: 'sessions',
      header: 'Sessoes',
      render: (u) => <InlineBar value={u.sessions} max={maxUserSessions} color={CATEGORICAL[0]} />,
    },
    {
      key: 'time',
      header: 'Tempo de uso',
      render: (u) => (
        <span className="tabular-nums font-medium text-slate-800">
          {formatDuration(u.seconds)}
        </span>
      ),
    },
    {
      key: 'views',
      header: 'Paineis vistos',
      className: 'text-right',
      render: (u) => <span className="tabular-nums text-slate-700">{u.iframe_views}</span>,
    },
    {
      key: 'last',
      header: 'Ultimo acesso',
      render: (u) => (
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-slate-600">{formatDateTime(u.last_access)}</span>
          {u.online && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              agora
            </span>
          )}
        </div>
      ),
    },
  ];

  const lastAccessColumns: Column<MonitoringOverview['last_accesses'][number]>[] = [
    {
      key: 'user',
      header: 'Usuario',
      render: (s) => (
        <div>
          <p className="font-medium text-slate-800">{s.name}</p>
          <p className="text-xs text-slate-500">{s.email ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'start',
      header: 'Entrou',
      render: (s) => (
        <span className="whitespace-nowrap text-slate-700">{formatDateTime(s.started_at)}</span>
      ),
    },
    {
      key: 'lastSeen',
      header: 'Ultimo sinal',
      render: (s) => (
        <span className="whitespace-nowrap text-slate-700">{formatDateTime(s.last_seen_at)}</span>
      ),
    },
    {
      key: 'duration',
      header: 'Duracao',
      render: (s) => (
        <span className="tabular-nums font-medium text-slate-800">
          {formatDuration(s.duration_seconds)}
        </span>
      ),
    },
    {
      key: 'online',
      header: 'Situacao',
      render: (s) =>
        s.online ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            No sistema
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">
            Encerrada
          </span>
        ),
    },
    {
      key: 'ip',
      header: 'IP',
      render: (s) => <span className="font-mono text-xs text-slate-500">{s.ip_address ?? '—'}</span>,
    },
  ];

  // Conta selecionada no filtro. Varias secoes mudam de rotulo quando o
  // recorte deixa de ser "todo o sistema" e passa a ser uma conta.
  const filteredUser = userId ? users.find((u) => u.id === userId) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoramento"
        description="Uso do sistema: acessos, tempo, paineis mais vistos e contas paradas."
      />

      {/* ------------------------------------------------------- filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="w-40">
          <Input label="De" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-40">
          <Input label="Ate" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="w-40">
          <Select
            label="Agrupar por"
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'day' | 'week')}
          >
            <option value="day">Dia</option>
            <option value="week">Semana</option>
          </Select>
        </div>
        <div className="w-56">
          <Select label="Usuario" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todos os usuarios</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select
            label="Conta parada ha"
            value={String(inactiveDays)}
            // So entra em jogo sem filtro de conta (ver a secao mais abaixo).
            disabled={Boolean(userId)}
            onChange={(e) => setInactiveDays(Number(e.target.value))}
          >
            <option value="7">7 dias ou mais</option>
            <option value="15">15 dias ou mais</option>
            <option value="30">30 dias ou mais</option>
            <option value="60">60 dias ou mais</option>
            <option value="90">90 dias ou mais</option>
          </Select>
        </div>
      </div>

      {filteredUser && (
        <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <svg className="mt-0.5 h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.879a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <p>
            Todos os numeros desta tela estao restritos a conta{' '}
            <strong>{filteredUser.name}</strong>. &quot;Paineis sem acesso&quot; passa a significar
            os que <strong>esta conta</strong> nao abriu, e a lista de contas paradas fica oculta
            &mdash; ela compara contas entre si.
          </p>
        </div>
      )}

      {data?.truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {icon(ICONS.alert)}
          <p>
            O periodo escolhido passou do limite de linhas lidas da auditoria, e os numeros abaixo
            estao <strong>incompletos</strong>. Escolha um intervalo menor.
          </p>
        </div>
      )}

      {/* --------------------------------------- aviso sobre o que o tempo e */}
      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <svg className="mt-0.5 h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>
          <strong>Como o tempo e medido.</strong> A aba aberta envia um sinal a cada 30 segundos, e
          a duracao da sessao vai do primeiro ao ultimo sinal &mdash; nao depende de a pessoa
          clicar em <strong>Sair</strong>. Fechou a aba, travou o navegador ou hibernou a maquina,
          o sinal para e a contagem congela sozinha. Conta apenas o tempo com a{' '}
          <strong>aba visivel</strong>: minimizada ou em outra aba nao soma. A precisao e de
          aproximadamente 30 segundos por sessao.
        </p>
      </div>

      {/* ----------------------------------------------------------- KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Sessoes"
          value={data?.summary.sessions ?? 0}
          hint={`${data?.summary.logins ?? 0} login(s) no periodo`}
          icon={icon(ICONS.sessions)}
        />
        <StatCard
          label="Contas que acessaram"
          value={data?.summary.active_users ?? 0}
          hint={
            data && data.summary.online_now > 0
              ? `${data.summary.online_now} no sistema agora`
              : 'usuarios distintos'
          }
          icon={icon(ICONS.users)}
          tone="emerald"
        />
        <StatCard
          label="Tempo total"
          value={formatDuration(data?.summary.total_seconds ?? 0)}
          hint="medido por sinal de presenca"
          icon={icon(ICONS.clock)}
        />
        <StatCard
          label="Tempo medio por sessao"
          value={formatDuration(data?.summary.avg_session_seconds ?? 0)}
          hint="com a aba visivel"
          icon={icon(ICONS.clock)}
          tone="slate"
        />
        <StatCard
          label="Paineis visualizados"
          value={data?.summary.iframe_views ?? 0}
          hint="carregamentos de painel"
          icon={icon(ICONS.views)}
        />
      </div>

      {/* ------------------------------------------- acessos ao longo do tempo */}
      <Card title="Acessos ao longo do tempo">
        {loading ? (
          <p className="py-16 text-center text-sm text-slate-500">Carregando...</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={timeline} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: INK_MUTED, fontSize: 11 }}
                stroke={AXIS_COLOR}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: INK_MUTED, fontSize: 11 }}
                stroke={AXIS_COLOR}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: INK }} iconType="square" />
              <Line
                type="monotone"
                dataKey="Sessoes"
                stroke={CATEGORICAL[0]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
              />
              <Line
                type="monotone"
                dataKey="Paineis vistos"
                stroke={CATEGORICAL[1]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ------------------------------------------- paineis mais acessados */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Paineis mais acessados">
          {topIframeRows.length === 0 ? (
            <p className="py-20 text-center text-sm text-slate-500">
              Nenhum painel foi aberto no periodo.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, topIframeRows.length * 34)}>
              <BarChart
                data={topIframeRows}
                layout="vertical"
                margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
              >
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: INK_MUTED, fontSize: 11 }}
                  stroke={AXIS_COLOR}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={190}
                  tick={{ fill: INK, fontSize: 11 }}
                  stroke={AXIS_COLOR}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="Acessos" fill={CATEGORICAL[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ------------------------------------------- heatmap dia x hora */}
        <Card title="Concentracao de uso (dia da semana x hora)">
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-[2px] text-[10px]">
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className="pb-1 font-normal text-slate-400">
                      {h % 3 === 0 ? h : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.heatmap ?? []).map((row, day) => (
                  <tr key={day}>
                    <th className="pr-2 text-right font-medium text-slate-500">
                      {WEEKDAY_LABELS[day]}
                    </th>
                    {row.map((count, hour) => (
                      <td
                        key={hour}
                        // O valor exato fica no title: a cor da a leitura de
                        // intensidade, o numero resolve a comparacao fina.
                        title={`${WEEKDAY_LABELS[day]}, ${String(hour).padStart(2, '0')}h — ${count} evento(s)`}
                        className="h-5 w-5 rounded-sm ring-1 ring-inset ring-slate-900/5"
                        style={{ backgroundColor: sequentialStep(count, heatmapMax) }}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <span>menos</span>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((step) => (
              <span
                key={step}
                className="h-3 w-5 rounded-sm ring-1 ring-inset ring-slate-900/5"
                style={{ backgroundColor: sequentialStep(step, 7) }}
              />
            ))}
            <span>mais</span>
            <span className="ml-auto">pico: {heatmapMax} evento(s)</span>
          </div>
        </Card>
      </div>

      {/* --------------------------------------------------- por usuario */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Acessos e tempo por usuario</h2>
        <PaginatedTable
          columns={userColumns}
          rows={data?.by_user ?? []}
          rowKey={(u) => u.user_id}
          loading={loading}
          emptyMessage="Nenhum acesso registrado no periodo."
          unit="usuario(s)"
          resetKey={data}
        />
      </section>

      {/* ------------------------------------------------- ultimos acessos */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Ultimos acessos</h2>
        <p className="mb-3 text-sm text-slate-500">
          Sessoes do periodo, da mais nova para a mais antiga (ate as 50 ultimas). A duracao vai do
          primeiro ao ultimo sinal de presenca.
        </p>
        <PaginatedTable
          columns={lastAccessColumns}
          rows={data?.last_accesses ?? []}
          rowKey={(s) => `${s.user_id}-${s.started_at}`}
          loading={loading}
          emptyMessage="Nenhuma sessao no periodo."
          unit="sessao(oes)"
          resetKey={data}
        />
      </section>

      {/* ---------------------------------------------------- por contrato */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Engajamento por contrato</h2>
        <p className="mb-3 text-sm text-slate-500">
          Tempo medido com a tela do contrato aberta e visivel, pelo mesmo sinal de presenca que
          mede o tempo por usuario. Aba escondida ou maquina suspensa nao somam.
        </p>
        <PaginatedTable
          columns={[
            {
              key: 'contract',
              header: 'Contrato',
              render: (c) => (
                <div>
                  <p className="font-medium text-slate-800">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.client_name ?? '—'}</p>
                </div>
              ),
            },
            {
              key: 'views',
              header: 'Paineis abertos',
              render: (c) => (
                <InlineBar value={c.iframe_views} max={maxContractViews} color={CATEGORICAL[0]} />
              ),
            },
            {
              key: 'visitors',
              header: 'Contas distintas',
              className: 'text-right',
              render: (c) => <span className="tabular-nums text-slate-700">{c.visitors}</span>,
            },
            {
              key: 'time',
              header: 'Tempo na tela',
              render: (c) => (
                <span className="tabular-nums text-slate-700">{formatDuration(c.seconds)}</span>
              ),
            },
          ]}
          rows={data?.by_contract ?? []}
          rowKey={(c) => c.contract_id}
          loading={loading}
          emptyMessage="Nenhum contrato acessado no periodo."
          unit="contrato(s)"
          resetKey={data}
        />
      </section>

      {/* ------------------------------------------------ paineis sem acesso */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          {filteredUser
            ? `Paineis ativos que ${filteredUser.name} nao abriu`
            : 'Paineis ativos sem nenhum acesso'}
        </h2>
        <p className="mb-3 text-sm text-slate-500">
          {filteredUser
            ? 'Paineis publicados e ativos que esta conta nao abriu no periodo.'
            : 'Estao publicados e ninguem abriu no periodo. Candidatos a desativar ou a cobrar adocao.'}
        </p>
        <PaginatedTable
          columns={[
            {
              key: 'title',
              header: 'Painel',
              render: (i) => <span className="font-medium text-slate-800">{i.title}</span>,
            },
            { key: 'contract', header: 'Contrato', render: (i) => <span>{i.contract_name}</span> },
            {
              key: 'client',
              header: 'Cliente',
              render: (i) => <span className="text-slate-600">{i.client_name}</span>,
            },
          ]}
          rows={data?.never_accessed ?? []}
          rowKey={(i) => i.iframe_id}
          loading={loading}
          unit="painel(is)"
          resetKey={data}
          emptyMessage={
            filteredUser
              ? 'Esta conta abriu todos os paineis ativos no periodo.'
              : 'Todos os paineis ativos foram acessados no periodo.'
          }
        />
      </section>

      {/* --------------------------------------- contas paradas e seguranca */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Comparacao entre contas: sem sentido com o filtro de uma conta. */}
        <section className={filteredUser ? 'hidden' : undefined}>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Contas ativas sem acesso</h2>
          <p className="mb-3 text-sm text-slate-500">
            Contas habilitadas que nao fazem login ha {data?.inactive_days ?? inactiveDays} dias ou
            mais. O ultimo login considera todo o historico, nao so o periodo filtrado.
          </p>
          <PaginatedTable
            columns={[
              {
                key: 'user',
                header: 'Usuario',
                render: (u) => (
                  <div>
                    <p className="font-medium text-slate-800">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                ),
              },
              { key: 'role', header: 'Perfil', render: (u) => <RoleBadge role={u.role} /> },
              {
                key: 'last',
                header: 'Ultimo login',
                render: (u) => (
                  <span className="whitespace-nowrap text-slate-600">
                    {formatRelative(u.last_login)}
                  </span>
                ),
              },
            ]}
            rows={data?.inactive_users ?? []}
            rowKey={(u) => u.user_id}
            loading={loading}
            emptyMessage="Todas as contas ativas acessaram recentemente."
            unit="conta(s)"
            resetKey={data}
          />
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Falhas de login</h2>
          <p className="mb-3 text-sm text-slate-500">
            Tentativas recusadas por conta ou IP. Volume concentrado num mesmo alvo merece olhada.
          </p>
          <PaginatedTable
            columns={[
              {
                key: 'identifier',
                header: 'Conta ou IP',
                render: (f) => (
                  <span className="font-mono text-xs text-slate-700">{f.identifier ?? '—'}</span>
                ),
              },
              {
                key: 'attempts',
                header: 'Tentativas',
                className: 'text-right',
                render: (f) => (
                  <span className="tabular-nums font-semibold text-slate-800">{f.attempts}</span>
                ),
              },
            ]}
            rows={data?.login_failures ?? []}
            rowKey={(f) => f.identifier ?? 'desconhecido'}
            loading={loading}
            emptyMessage="Nenhuma falha de login no periodo."
            unit="origem(ns)"
            resetKey={data}
          />
        </section>
      </div>
    </div>
  );
}
