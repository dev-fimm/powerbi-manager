import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { PageHeader, RoleBadge } from '../components/ui/Card';
import { Select } from '../components/ui/Field';
import { Table, type Column } from '../components/ui/Table';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import { MANAGEABLE_SCREENS } from '../lib/screens';
import type { Iframe, User } from '../types';

const MANAGEABLE_KEYS = MANAGEABLE_SCREENS.map((s) => s.key);

/** Compara duas listas ignorando ordem/duplicatas. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

/** Mantem apenas telas configuraveis, ordenadas, para comparar estados. */
function normalizeScreens(screens: string[] | undefined): string {
  return (screens ?? []).filter((s) => MANAGEABLE_KEYS.includes(s)).sort().join(',');
}

export function PermissionsPage() {
  const toast = useToast();

  const [users, setUsers] = useState<User[]>([]);
  const [iframes, setIframes] = useState<Iframe[]>([]);
  const [loading, setLoading] = useState(true);

  // -------- Secao 1: telas (menu) --------
  const [screenEdits, setScreenEdits] = useState<Record<string, string[]>>({});
  const [savingScreensId, setSavingScreensId] = useState<string | null>(null);

  // -------- Secao 2: dashboards (viewer) --------
  const [viewerId, setViewerId] = useState('');
  const [grantEdits, setGrantEdits] = useState<string[]>([]);
  const [grantBaseline, setGrantBaseline] = useState<string[]>([]);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, iframeList] = await Promise.all([
        api.get<User[]>('/users'),
        api.get<Iframe[]>('/iframes?is_active=true'),
      ]);
      setUsers(userList);
      setIframes(iframeList);
      setScreenEdits(
        Object.fromEntries(
          userList.map((u) => [u.id, u.allowed_screens.filter((s) => MANAGEABLE_KEYS.includes(s))]),
        ),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar as permissoes.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Carrega os dashboards concedidos quando um VISUALIZADOR e selecionado.
  useEffect(() => {
    if (!viewerId) {
      setGrantEdits([]);
      setGrantBaseline([]);
      return;
    }
    setGrantLoading(true);
    api
      .get<{ iframe_ids: string[] }>(`/users/${viewerId}/iframes`)
      .then((res) => {
        setGrantBaseline(res.iframe_ids);
        setGrantEdits(res.iframe_ids);
      })
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar os dashboards.'),
      )
      .finally(() => setGrantLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  // ---------------------------------------------------------------- telas
  function toggleScreen(userId: string, key: string, checked: boolean) {
    setScreenEdits((prev) => {
      const set = new Set(prev[userId] ?? []);
      if (checked) set.add(key);
      else set.delete(key);
      return { ...prev, [userId]: Array.from(set) };
    });
  }

  const isScreenDirty = useCallback(
    (u: User) => normalizeScreens(screenEdits[u.id]) !== normalizeScreens(u.allowed_screens),
    [screenEdits],
  );

  async function saveScreens(u: User) {
    setSavingScreensId(u.id);
    try {
      const updated = await api.put<User>(`/users/${u.id}/screens`, {
        screens: screenEdits[u.id] ?? [],
      });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
      setScreenEdits((prev) => ({
        ...prev,
        [u.id]: updated.allowed_screens.filter((s) => MANAGEABLE_KEYS.includes(s)),
      }));
      toast.success(`Telas de "${u.name}" atualizadas.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar as telas.');
    } finally {
      setSavingScreensId(null);
    }
  }

  const screenColumns: Column<User>[] = useMemo(() => {
    const base: Column<User>[] = [
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
    ];

    const screenCols: Column<User>[] = MANAGEABLE_SCREENS.map((screen) => ({
      key: screen.key,
      header: screen.label,
      className: 'text-center',
      render: (u) =>
        u.role === 'ADMIN' ? (
          <span className="text-brand-500" title="ADMIN acessa todas as telas">
            <svg className="mx-auto h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        ) : (
          <input
            type="checkbox"
            checked={screenEdits[u.id]?.includes(screen.key) ?? false}
            onChange={(e) => toggleScreen(u.id, screen.key, e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
            aria-label={`${screen.label} para ${u.name}`}
          />
        ),
    }));

    const actions: Column<User> = {
      key: 'actions',
      header: 'Acoes',
      className: 'text-right',
      render: (u) =>
        u.role === 'ADMIN' ? (
          <span className="text-xs text-slate-500">Todas as telas</span>
        ) : (
          <Button
            size="sm"
            onClick={() => saveScreens(u)}
            disabled={!isScreenDirty(u)}
            loading={savingScreensId === u.id}
          >
            Salvar
          </Button>
        ),
    };

    return [...base, ...screenCols, actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenEdits, savingScreensId, isScreenDirty]);

  // ---------------------------------------------------------------- dashboards
  const viewers = useMemo(() => users.filter((u) => u.role === 'VISUALIZADOR'), [users]);

  // Agrupa os dashboards ativos por contrato.
  const groups = useMemo(() => {
    const map = new Map<string, { contractName: string; clientName: string; items: Iframe[] }>();
    for (const iframe of iframes) {
      const key = iframe.contract_id;
      if (!map.has(key)) {
        map.set(key, {
          contractName: iframe.contract?.name ?? 'Contrato',
          clientName: iframe.contract?.client_name ?? '',
          items: [],
        });
      }
      map.get(key)!.items.push(iframe);
    }
    return Array.from(map.values()).sort((a, b) => a.contractName.localeCompare(b.contractName));
  }, [iframes]);

  const grantDirty = !sameSet(grantEdits, grantBaseline);

  function toggleIframe(id: string, checked: boolean) {
    setGrantEdits((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }

  function toggleContractGroup(items: Iframe[], checked: boolean) {
    const ids = items.map((i) => i.id);
    setGrantEdits((prev) =>
      checked
        ? [...new Set([...prev, ...ids])]
        : prev.filter((x) => !ids.includes(x)),
    );
  }

  async function saveGrants() {
    if (!viewerId) return;
    setGrantSaving(true);
    try {
      const res = await api.put<{ iframe_ids: string[] }>(`/users/${viewerId}/iframes`, {
        iframe_ids: grantEdits,
      });
      setGrantBaseline(res.iframe_ids);
      setGrantEdits(res.iframe_ids);
      toast.success('Acesso aos dashboards atualizado.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar os dashboards.');
    } finally {
      setGrantSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Permissoes"
          description="Controle o menu (telas) de cada conta e distribua o acesso aos paineis da tela Paineis."
        />

        <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <svg className="mt-0.5 h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>
            <strong>Telas</strong> controlam o menu de cada conta. <strong>Dashboards</strong>{' '}
            controlam quais paineis um VISUALIZADOR ve na tela Paineis &mdash; sem concessao, ele nao ve
            nenhum painel. ADMIN acessa tudo.
          </p>
        </div>
      </div>

      {/* ============================ Secao: Telas ============================ */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Telas (menu)</h2>
        <Table
          columns={screenColumns}
          rows={users}
          rowKey={(u) => u.id}
          loading={loading}
          emptyMessage="Nenhum usuario cadastrado."
        />
      </section>

      {/* ========================= Secao: Dashboards ========================= */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Acesso aos Paineis</h2>
        <p className="mb-3 text-sm text-slate-500">
          Distribua o acesso aos paineis por conta VISUALIZADOR. Aplica-se somente a este perfil.
        </p>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="max-w-sm">
            <Select
              label="Conta VISUALIZADOR"
              value={viewerId}
              onChange={(e) => setViewerId(e.target.value)}
            >
              <option value="">Selecione uma conta...</option>
              {viewers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </div>

          {viewers.length === 0 && (
            <p className="mt-4 text-sm text-slate-500">Nenhuma conta VISUALIZADOR cadastrada.</p>
          )}

          {viewerId && (
            <div className="mt-5">
              {grantLoading ? (
                <p className="text-sm text-slate-500">Carregando dashboards...</p>
              ) : groups.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum dashboard ativo cadastrado.</p>
              ) : (
                <>
                  <div className="space-y-4">
                    {groups.map((group) => {
                      const ids = group.items.map((i) => i.id);
                      const allChecked = ids.every((id) => grantEdits.includes(id));
                      const someChecked = ids.some((id) => grantEdits.includes(id));
                      return (
                        <div
                          key={group.contractName + group.clientName}
                          className="rounded-lg border border-slate-200"
                        >
                          <label className="flex cursor-pointer items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                            <input
                              type="checkbox"
                              checked={allChecked}
                              ref={(el) => {
                                if (el) el.indeterminate = someChecked && !allChecked;
                              }}
                              onChange={(e) => toggleContractGroup(group.items, e.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                            />
                            <span className="font-medium text-slate-800">{group.contractName}</span>
                            <span className="text-xs text-slate-500">{group.clientName}</span>
                          </label>
                          <div className="divide-y divide-slate-100">
                            {group.items.map((iframe) => (
                              <label
                                key={iframe.id}
                                className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={grantEdits.includes(iframe.id)}
                                  onChange={(e) => toggleIframe(iframe.id, e.target.checked)}
                                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                                />
                                <div className="min-w-0">
                                  <p className="font-medium text-slate-800">{iframe.title}</p>
                                  {iframe.description && (
                                    <p className="truncate text-xs text-slate-500">
                                      {iframe.description}
                                    </p>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-5 flex items-center gap-3">
                    <Button onClick={saveGrants} disabled={!grantDirty} loading={grantSaving}>
                      Salvar acesso aos dashboards
                    </Button>
                    <span className="text-sm text-slate-500">
                      {grantEdits.length} painel(is) selecionado(s)
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
