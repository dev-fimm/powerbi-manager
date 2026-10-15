import type { Request } from 'express';
import { prisma } from '../lib/prisma';

/**
 * ============================================================
 * SESSAO DE USO (heartbeat)
 * ============================================================
 * Mede quanto tempo a conta ficou com o sistema aberto, sem depender de
 * nenhum evento de saida.
 *
 * Como funciona: a aba manda um sinal a cada HEARTBEAT_SECONDS enquanto
 * estiver visivel. Cada sinal so adianta `lastSeenAt` da sessao aberta da
 * conta. Duracao = lastSeenAt - startedAt.
 *
 * Tres propriedades que vem de graca nesse desenho:
 *
 * 1. Nao existe sessao "aberta para sempre". Fechou a aba, travou o
 *    navegador, hibernou a maquina: o sinal para e a duracao congela.
 * 2. Varias abas NAO contam em dobro. A sessao e identificada pela CONTA,
 *    nao pela aba - tres abas abertas apenas renovam o mesmo lastSeenAt.
 *    Se a sessao fosse por aba, quem trabalha com abas paralelas apareceria
 *    com o triplo do tempo.
 * 3. Tempo ocioso com a aba em segundo plano nao entra, porque o front so
 *    sinaliza com a aba visivel.
 */

/** Intervalo entre sinais, combinado com o front (lib/heartbeat.ts). */
export const HEARTBEAT_SECONDS = 30;

/**
 * Silencio a partir do qual o proximo sinal abre uma sessao NOVA em vez de
 * continuar a anterior. Precisa ser maior que o intervalo com folga, para
 * que uma aba lenta ou um pico de rede nao parta a sessao em duas; e menor
 * que um intervalo em que a pessoa claramente saiu e voltou.
 */
export const SESSION_GAP_SECONDS = 5 * 60;

/**
 * Teto de duracao de uma sessao. O JWT vale 8h por padrao (JWT_EXPIRES_IN):
 * nada acima disso e sessao real.
 */
export const MAX_SESSION_SECONDS = 12 * 60 * 60;

/**
 * Maior intervalo entre dois sinais que ainda conta como tempo de tela.
 *
 * O heartbeat so atesta o que ele viu: se dois sinais chegaram com 30s de
 * diferenca, aqueles 30s existiram. Um intervalo muito maior significa que a
 * aba ficou escondida ou a maquina dormiu - nesse caso o tempo NAO e
 * atribuido, em vez de ser chutado. Dois intervalos de folga cobrem um sinal
 * perdido por rede ruim sem inventar tempo.
 */
export const MAX_ATTRIBUTABLE_GAP_SECONDS = 2 * HEARTBEAT_SECONDS;

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

export interface HeartbeatResult {
  sessionId: string;
  startedAt: Date;
  lastSeenAt: Date;
  durationSeconds: number;
  /** true quando este sinal abriu uma sessao nova. */
  started: boolean;
}

/**
 * Registra um sinal da conta: continua a sessao aberta ou comeca outra.
 * Nunca lanca para o chamador decidir - o heartbeat e best-effort e nao pode
 * atrapalhar a navegacao.
 */
export async function recordHeartbeat(
  req: Request,
  userId: string,
  /** Contrato que a aba esta exibindo agora, se estiver numa tela de contrato. */
  contractId?: string,
): Promise<HeartbeatResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SESSION_GAP_SECONDS * 1000);

  /**
   * "Procurar ou criar" precisa ser atomico POR CONTA. Dois sinais que chegam
   * no mesmo instante - duas abas abertas juntas, ou o StrictMode do React
   * disparando o efeito duas vezes em desenvolvimento - fariam os dois a
   * mesma leitura, nao achariam sessao aberta, e criariam uma sessao cada.
   * O resultado seria contagem de sessao inflada e tempo contado em dobro,
   * exatamente o que a chave por conta (e nao por aba) existe para evitar.
   *
   * O lock consultivo serializa apenas os sinais DA MESMA conta: contas
   * diferentes nao esperam umas pelas outras, e ele se solta sozinho no fim
   * da transacao, inclusive se ela falhar.
   */
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    const current = await tx.accessSession.findFirst({
      where: { userId, lastSeenAt: { gte: cutoff } },
      orderBy: { lastSeenAt: 'desc' },
    });

    // Sessao que ja bateu no teto: congela e comeca outra, em vez de crescer
    // indefinidamente (aba deixada aberta por dias).
    const tooLong =
      current !== null &&
      (now.getTime() - current.startedAt.getTime()) / 1000 > MAX_SESSION_SECONDS;

    if (current && !tooLong) {
      /**
       * O intervalo desde o sinal anterior pertence ao contrato em que a aba
       * ESTAVA durante o intervalo (lastContractId), e nao ao que ela mostra
       * agora - quem acabou de trocar de tela nao passou o intervalo na tela
       * nova.
       */
      const gap = Math.round((now.getTime() - current.lastSeenAt.getTime()) / 1000);

      if (
        current.lastContractId &&
        gap > 0 &&
        gap <= MAX_ATTRIBUTABLE_GAP_SECONDS
      ) {
        await tx.sessionContractUsage.upsert({
          where: {
            sessionId_contractId: {
              sessionId: current.id,
              contractId: current.lastContractId,
            },
          },
          create: { sessionId: current.id, contractId: current.lastContractId, seconds: gap },
          update: { seconds: { increment: gap } },
        });
      }

      const updated = await tx.accessSession.update({
        where: { id: current.id },
        data: { lastSeenAt: now, lastContractId: contractId ?? null },
      });

      return {
        sessionId: updated.id,
        startedAt: updated.startedAt,
        lastSeenAt: updated.lastSeenAt,
        durationSeconds: Math.round(
          (updated.lastSeenAt.getTime() - updated.startedAt.getTime()) / 1000,
        ),
        started: false,
      };
    }

    const created = await tx.accessSession.create({
      data: {
        userId,
        startedAt: now,
        lastSeenAt: now,
        // Primeiro sinal: ainda nao ha intervalo a atribuir, so o ponto de
        // partida para o proximo.
        lastContractId: contractId ?? null,
        ipAddress: clientIp(req),
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      },
    });

    return {
      sessionId: created.id,
      startedAt: created.startedAt,
      lastSeenAt: created.lastSeenAt,
      durationSeconds: 0,
      started: true,
    };
  });
}

/**
 * Duracao de uma sessao em segundos, com o teto aplicado.
 *
 * O ultimo sinal fica, em media, meio intervalo antes do momento real em que
 * a pessoa saiu - ninguem fecha a aba exatamente quando o sinal acabou de
 * sair. A duracao e portanto uma medicao com precisao de +/- o intervalo do
 * heartbeat, e nao um valor exato ao segundo.
 */
export function sessionDuration(session: { startedAt: Date; lastSeenAt: Date }): number {
  const raw = Math.round((session.lastSeenAt.getTime() - session.startedAt.getTime()) / 1000);
  return Math.max(0, Math.min(raw, MAX_SESSION_SECONDS));
}

/** true se o ultimo sinal e recente o bastante para a conta estar online. */
export function isOnline(session: { lastSeenAt: Date }, now = new Date()): boolean {
  return now.getTime() - session.lastSeenAt.getTime() <= SESSION_GAP_SECONDS * 1000;
}
