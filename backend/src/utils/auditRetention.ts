import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AuditAction } from './audit';

/**
 * ============================================================
 * RETENCAO DA AUDITORIA
 * ============================================================
 * Apaga os registros de audit_logs mais antigos que AUDIT_LOG_RETENTION_DAYS.
 *
 * Por que existe: cada linha guarda IP e user-agent do usuario - dado pessoal.
 * Guardar isso indefinidamente amplia o estrago de um vazamento do banco sem
 * beneficio operacional, e contraria o principio de nao reter alem da
 * finalidade. O expurgo tambem evita que a tabela cresca sem limite (o
 * PAGE_VIEW registra CADA navegacao de CADA usuario).
 *
 * O job roda no boot e depois a cada 24h. Nao usa cron externo de proposito:
 * uma unica instancia da API basta, e o delete e idempotente - se duas
 * instancias rodarem juntas, a segunda simplesmente nao encontra nada.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Remove os logs vencidos. Retorna quantos foram apagados. */
export async function purgeExpiredAuditLogs(): Promise<number> {
  const days = env.auditLogRetentionDays;
  if (days <= 0) return 0; // retencao desligada

  const cutoff = new Date(Date.now() - days * ONE_DAY_MS);

  /**
   * access_sessions entra na MESMA politica: a tabela tambem guarda IP e
   * user-agent, isto e, dado pessoal. Deixar as sessoes fora do expurgo
   * esvaziaria a regra - bastaria olhar a outra tabela para reconstruir de
   * onde cada conta acessou.
   */
  const purgedSessions = await prisma.accessSession.deleteMany({
    where: { startedAt: { lt: cutoff } },
  });

  /**
   * Contadores de login vencidos tambem saem: a tabela guarda endereco IP, e
   * um contador que ja passou da janela e do bloqueio nao serve para mais
   * nada. Usa a mesma data de corte das demais tabelas.
   */
  const purgedThrottle = await prisma.loginThrottle.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
      OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }],
    },
  });

  if (purgedThrottle.count > 0) {
    // eslint-disable-next-line no-console
    console.log(`[auditoria] ${purgedThrottle.count} contador(es) de login vencido(s) removido(s).`);
  }

  if (purgedSessions.count > 0) {
    // eslint-disable-next-line no-console
    console.log(`[auditoria] ${purgedSessions.count} sessao(oes) de uso vencida(s) removida(s).`);
  }

  // Indice em audit_logs(created_at) ja existe no schema, entao o filtro
  // nao faz varredura completa da tabela.
  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (count > 0) {
    // eslint-disable-next-line no-console
    console.log(`[auditoria] ${count} registro(s) anteriores a ${cutoff.toISOString()} removidos.`);

    // O proprio expurgo fica registrado: sem isso, um buraco no historico
    // seria indistinguivel de adulteracao.
    await prisma.auditLog.create({
      data: {
        action: AuditAction.AUDIT_PURGE,
        entity: 'AuditLog',
        description:
          `Expurgo automatico: ${count} registro(s) anteriores a ` +
          `${cutoff.toISOString().slice(0, 10)} removidos (retencao de ${days} dias).`,
      },
    });
  }

  return count;
}

/**
 * Agenda o expurgo (uma vez agora, depois a cada 24h) e devolve uma funcao
 * para cancelar - usada no shutdown para o processo nao ficar preso.
 */
export function scheduleAuditRetention(): () => void {
  if (env.auditLogRetentionDays <= 0) {
    // eslint-disable-next-line no-console
    console.log('[auditoria] expurgo desligado (AUDIT_LOG_RETENTION_DAYS=0).');
    return () => {};
  }

  const run = () => {
    purgeExpiredAuditLogs().catch((err) => {
      // Falhar aqui nunca pode derrubar a API.
      // eslint-disable-next-line no-console
      console.error('[auditoria] falha no expurgo de logs:', err);
    });
  };

  run();

  const timer = setInterval(run, ONE_DAY_MS);
  // unref: um timer pendente nao deve impedir o processo de encerrar.
  timer.unref();

  return () => clearInterval(timer);
}
