import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { PageHeader, StatusBadge } from '../components/ui/Card';
import { useToast } from '../contexts/ToastContext';
import { API_BASE_URL, ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { Contract, ViewerContractResponse } from '../types';

export function ViewerPage() {
  const { contractId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [data, setData] = useState<ViewerContractResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lista de contratos disponiveis (a API ja exclui os ENCERRADOS - regra 6).
  useEffect(() => {
    if (contractId) return;
    setLoading(true);
    api
      .get<Contract[]>('/viewer/contracts')
      .then(setContracts)
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar contratos.'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  // Iframes ativos do contrato selecionado (regras 5 e 6 aplicadas no backend).
  useEffect(() => {
    if (!contractId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<ViewerContractResponse>(`/viewer/contracts/${contractId}/iframes`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar paineis.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  // ------------------------------------------------ Lista de contratos
  if (!contractId) {
    return (
      <div>
        <PageHeader
          title="Paineis"
          description="Selecione um contrato para visualizar seus paineis do Power BI."
        />

        {loading && <p className="text-sm text-slate-500">Carregando contratos...</p>}

        {!loading && contracts.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="font-medium text-slate-700">Nenhum contrato disponivel</p>
            <p className="mt-1 text-sm text-slate-500">
              Voce ainda nao tem contratos associados, ou todos os seus contratos estao encerrados.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {contracts.map((contract) => (
            <button
              key={contract.id}
              type="button"
              onClick={() => navigate(`/paineis/${contract.id}`)}
              className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">
                  {contract.name}
                </h3>
                <StatusBadge status={contract.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">{contract.client_name}</p>
              {contract.description && (
                <p className="mt-3 line-clamp-2 text-sm text-slate-600">{contract.description}</p>
              )}
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>
                  {formatDate(contract.start_date)} - {formatDate(contract.end_date)}
                </span>
                <span className="font-medium text-brand-600">
                  {contract.iframes_count ?? 0} painel(is)
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ------------------------------------------------ Paineis do contrato
  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/paineis')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Voltar aos contratos
      </button>

      {loading && <p className="text-sm text-slate-500">Carregando paineis...</p>}

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="font-medium text-amber-800">Paineis indisponiveis</p>
          <p className="mt-1 text-sm text-amber-700">{error}</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/paineis')}>
            Voltar
          </Button>
        </div>
      )}

      {data && (
        <>
          <PageHeader
            title={data.contract.name}
            description={data.contract.description ?? data.contract.client_name}
            action={<StatusBadge status={data.contract.status} />}
          />

          {data.iframes.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="font-medium text-slate-700">Nenhum painel ativo neste contrato</p>
              <p className="mt-1 text-sm text-slate-500">
                Os paineis podem estar desativados. Fale com o gestor do contrato.
              </p>
            </div>
          )}

          <div className="space-y-6">
            {data.iframes.map((iframe) => (
              <article
                key={iframe.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                {/* Titulo e descricao acima do iframe */}
                <header className="border-b border-slate-200 px-5 py-4">
                  <h2 className="font-semibold text-slate-900">{iframe.title}</h2>
                  {iframe.description && (
                    <p className="mt-1 text-sm leading-relaxed text-slate-500">
                      {iframe.description}
                    </p>
                  )}
                </header>

                {/* O src aponta para a rota de embed da nossa API, que valida o
                    token e redireciona para o Power BI. A URL real do Power BI
                    NAO trafega para o cliente (nem no JSON, nem no src). */}
                <iframe
                  title={iframe.title}
                  src={`${API_BASE_URL}/viewer/iframes/${iframe.id}/embed?t=${encodeURIComponent(iframe.embed_token)}`}
                  width="100%"
                  // Altura responsiva: ocupa 80% da altura da tela (min. 640px)
                  // para o dashboard aparecer grande, sem cortar em telas menores.
                  style={{ border: 0, display: 'block', width: '100%', height: '80vh', minHeight: '640px' }}
                  frameBorder={0}
                  allowFullScreen
                  loading="lazy"
                  /* O token de embed viaja na query string desta URL. Sem isto,
                     ele seria enviado no cabecalho Referer para terceiros. */
                  referrerPolicy="no-referrer"
                  /* Confina o conteudo de terceiros: sem sandbox, o documento
                     embutido pode navegar a janela principal (redirecionar o
                     usuario para fora do sistema) e abrir modais nativos.
                     allow-same-origin e necessario porque o Power BI usa
                     storage/cookies proprios - e seguro aqui porque o documento
                     final e app.powerbi.com, uma origem diferente da nossa, e
                     portanto nao alcanca o DOM da aplicacao. */
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
                />
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
