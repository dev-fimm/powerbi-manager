import { api } from './api';

/**
 * ============================================================
 * HEARTBEAT DE SESSAO
 * ============================================================
 * Sinal periodico de "ainda estou aqui", usado para medir tempo de uso sem
 * depender de o usuario clicar em "Sair" - o evento que a maioria nunca
 * dispara, porque simplesmente fecha a aba.
 *
 * Duas decisoes que definem o que o numero significa:
 *
 * - So sinaliza com a aba VISIVEL (document.visibilityState). Aba em segundo
 *   plano nao conta, entao o tempo medido e "tempo com o sistema a frente",
 *   e nao "tempo com a aba existindo".
 * - NAO exige mouse ou teclado. Ler um painel do Power BI por 20 minutos nao
 *   gera interacao nenhuma, e um medidor por atividade registraria zero
 *   justamente no uso que mais interessa medir aqui.
 *
 * O sinal leva junto o contrato que a aba esta exibindo, quando houver. E o
 * que permite medir tempo POR CONTRATO - antes isso era estimado pelo
 * intervalo entre eventos de navegacao.
 */

/** Extrai o contrato da rota "/paineis/<uuid>", se for esse o caso. */
const VIEWER_PATH = /^\/paineis\/([0-9a-fA-F-]{36})$/;

function currentContractId(): string | undefined {
  // Le a URL na hora do sinal: numa SPA ela sempre reflete a tela atual, e
  // assim o heartbeat nao precisa ser religado a cada navegacao.
  const match = VIEWER_PATH.exec(window.location.pathname);
  return match ? match[1] : undefined;
}

/** Precisa bater com HEARTBEAT_SECONDS do backend (utils/accessSession.ts). */
const INTERVAL_MS = 30_000;

/**
 * Comeca a sinalizar e devolve a funcao que para.
 *
 * O envio e best-effort: falha de rede e engolida de proposito. Perder um
 * sinal custa, no maximo, um intervalo de imprecisao na duracao - nao vale
 * mostrar erro ao usuario por causa disso.
 */
export function startHeartbeat(): () => void {
  let timer: number | undefined;

  const ping = () => {
    if (document.visibilityState !== 'visible') return;
    api.post('/logs/heartbeat', { contract_id: currentContractId() }).catch(() => {
      /* medicao de uso e best-effort; nunca atrapalha a navegacao */
    });
  };

  const onVisibilityChange = () => {
    // Voltou para a aba: sinaliza na hora, sem esperar o proximo ciclo.
    if (document.visibilityState === 'visible') ping();
  };

  ping();
  timer = window.setInterval(ping, INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    if (timer !== undefined) window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
