import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, StatCard, StatusBadge } from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { Contract, DashboardSummary } from '../types';

const icon = (d: string) => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

export function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<DashboardSummary>('/dashboard/summary'),
      api.get<Contract[]>('/contracts'),
    ])
      .then(([data, list]) => {
        setSummary(data);
        setContracts(list.slice(0, 5));
      })
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar o dashboard.'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        title={`Ola, ${user?.name?.split(' ')[0] ?? ''}`}
        description="Visao geral dos contratos e paineis disponiveis para o seu perfil."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Contratos ativos"
          value={loading ? '-' : (summary?.contracts.ativos ?? 0)}
          hint={loading ? undefined : `${summary?.contracts.total ?? 0} contratos no total`}
          tone="emerald"
          icon={icon('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z')}
        />
        <StatCard
          label="Iframes ativos"
          value={loading ? '-' : (summary?.iframes.ativos ?? 0)}
          hint={loading ? undefined : `${summary?.iframes.total ?? 0} iframes cadastrados`}
          tone="brand"
          icon={icon('M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2')}
        />
        <StatCard
          label="Contratos suspensos"
          value={loading ? '-' : (summary?.contracts.suspensos ?? 0)}
          hint={loading ? undefined : `${summary?.contracts.encerrados ?? 0} encerrados`}
          tone="amber"
          icon={icon('M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z')}
        />
        {/* Card de usuarios: apenas ADMIN (a API tambem so retorna nesse perfil). */}
        {isAdmin && (
          <StatCard
            label="Usuarios"
            value={loading ? '-' : (summary?.users?.total ?? 0)}
            hint={loading ? undefined : `${summary?.users?.ativos ?? 0} ativos`}
            tone="slate"
            icon={icon('M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z')}
          />
        )}
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Contratos recentes</h2>
          <Link to="/contracts" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Ver todos
          </Link>
        </header>

        <div className="divide-y divide-slate-100">
          {loading && <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>}

          {!loading && contracts.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Nenhum contrato disponivel para o seu perfil.
            </p>
          )}

          {!loading &&
            contracts.map((contract) => (
              <Link
                key={contract.id}
                to={`/paineis/${contract.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{contract.name}</p>
                  <p className="truncate text-sm text-slate-500">
                    {contract.client_name} &middot; {formatDate(contract.start_date)} a{' '}
                    {formatDate(contract.end_date)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500">
                    {contract.iframes_count ?? 0} painel(is)
                  </span>
                  <StatusBadge status={contract.status} />
                </div>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}
