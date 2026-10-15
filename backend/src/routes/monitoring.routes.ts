import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import { requireFullAccess } from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { isOnline, sessionDuration } from '../utils/accessSession';
import { AuditAction } from '../utils/audit';
import {
  type AuditRow,
  type Granularity,
  contractIdFromPath,
  dayKey,
  periodKey,
  periodRange,
  tally,
} from '../utils/monitoring';
import { monitoringQuerySchema } from '../validators/schemas';

export const monitoringRoutes = Router();

// Monitoramento e uma tela de gestao: mesmo acesso dos Logs (regra 2).
monitoringRoutes.use(authenticate, requireFullAccess);

/**
 * Teto de linhas lidas de audit_logs numa consulta. PAGE_VIEW e IFRAME_VIEW
 * crescem rapido; sem teto, um periodo largo carregaria a tabela inteira na
 * memoria. Quando o teto e atingido a resposta avisa (`truncated: true`) para
 * a tela poder dizer que o periodo e grande demais em vez de exibir numero
 * silenciosamente incompleto.
 */
const MAX_ROWS = 60_000;

/** Converte "yyyy-mm-dd" no inicio (00:00) ou fim (23:59:59.999) do dia local. */
function parseDay(value: string, endOfDay: boolean): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Janela padrao: ultimos 30 dias (incluindo hoje). */
function defaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 29, 0, 0, 0, 0);
  return { from, to };
}

/**
 * GET /api/monitoring/overview?from=&to=&granularity=day|week
 *
 * Devolve todos os blocos da tela de Monitoramento numa resposta: a tela
 * carrega tudo de uma vez, e varias metricas saem do MESMO conjunto de linhas
 * de audit_logs - buscar uma vez e agregar em memoria evita repetir a consulta
 * mais pesada do sistema cinco vezes.
 */
monitoringRoutes.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const q = monitoringQuerySchema.parse(req.query);
    const granularity: Granularity = q.granularity;

    const fallback = defaultRange();
    const from = q.from ? parseDay(q.from, false) : fallback.from;
    const to = q.to ? parseDay(q.to, true) : fallback.to;

    const [rows, sessionRows, contractUsage, iframes, contracts, users] = await Promise.all([
      prisma.auditLog.findMany({
        /**
         * O filtro por conta entra aqui, na origem: todas as metricas de uso
         * derivam destas linhas, entao restringir a consulta ja escopa
         * sessoes, paineis, contratos, heatmap e falhas de login de uma vez.
         *
         * Falha de login com e-mail inexistente tem user_id nulo e portanto
         * fica de fora quando se filtra por conta - correto, nao ha conta a
         * quem atribuir.
         */
        where: {
          createdAt: { gte: from, lte: to },
          ...(q.user_id ? { userId: q.user_id } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_ROWS,
        select: {
          userId: true,
          userName: true,
          userEmail: true,
          action: true,
          entityId: true,
          ipAddress: true,
          createdAt: true,
        },
      }),
      /**
       * Sessoes medidas por heartbeat: a fonte do TEMPO. Antes o tempo saia
       * do par LOGIN/LOGOUT do audit_logs, o que so funcionava para quem
       * clicava em "Sair" - ver utils/accessSession.ts.
       */
      prisma.accessSession.findMany({
        where: {
          startedAt: { gte: from, lte: to },
          ...(q.user_id ? { userId: q.user_id } : {}),
        },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          startedAt: true,
          lastSeenAt: true,
          ipAddress: true,
          user: { select: { name: true, email: true } },
        },
      }),
      /**
       * Tempo MEDIDO por contrato, somado dos intervalos entre sinais de
       * heartbeat. O recorte por periodo e por conta vem da sessao a que
       * cada linha pertence.
       */
      prisma.sessionContractUsage.groupBy({
        by: ['contractId'],
        where: {
          session: {
            startedAt: { gte: from, lte: to },
            ...(q.user_id ? { userId: q.user_id } : {}),
          },
        },
        _sum: { seconds: true },
      }),
      prisma.iframe.findMany({
        select: {
          id: true,
          title: true,
          isActive: true,
          contractId: true,
          contract: { select: { id: true, name: true, clientName: true } },
        },
      }),
      prisma.contract.findMany({ select: { id: true, name: true, clientName: true } }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, isActive: true },
      }),
    ]);

    const auditRows: AuditRow[] = rows;
    const truncated = rows.length >= MAX_ROWS;

    const now = new Date();
    const sessions = sessionRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.user.name,
      email: row.user.email,
      startedAt: row.startedAt,
      lastSeenAt: row.lastSeenAt,
      durationSeconds: sessionDuration(row),
      online: isOnline(row, now),
      ipAddress: row.ipAddress,
    }));

    const iframeViews = auditRows.filter((r) => r.action === AuditAction.IFRAME_VIEW);
    const loginFailures = auditRows.filter((r) => r.action === AuditAction.LOGIN_FAILED);

    const iframeById = new Map(iframes.map((i) => [i.id, i]));
    const contractById = new Map(contracts.map((c) => [c.id, c]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const periods = periodRange(from, to, granularity);

    /**
     * Indices montados numa unica passada pelos acessos a paineis. A versao
     * ingenua (um filter sobre iframeViews dentro de cada map) e O(n*m) e
     * ficaria pesada justamente no periodo grande, onde a tela mais importa.
     */
    const viewersByIframe = new Map<string, Set<string | null>>();
    const viewersByContract = new Map<string, Set<string | null>>();
    for (const r of iframeViews) {
      if (!r.entityId) continue;

      const forIframe = viewersByIframe.get(r.entityId) ?? new Set<string | null>();
      forIframe.add(r.userId);
      viewersByIframe.set(r.entityId, forIframe);

      const contractId = iframeById.get(r.entityId)?.contractId;
      if (contractId) {
        const forContract = viewersByContract.get(contractId) ?? new Set<string | null>();
        forContract.add(r.userId);
        viewersByContract.set(contractId, forContract);
      }
    }

    // ------------------------------------------------------------- KPIs
    const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
    const logins = auditRows.filter((r) => r.action === AuditAction.LOGIN).length;

    const summary = {
      sessions: sessions.length,
      logins,
      /** Contas distintas que acessaram no periodo. */
      active_users: new Set(sessions.map((s) => s.userId)).size,
      iframe_views: iframeViews.length,
      login_failures: loginFailures.length,
      /** Tempo medido por heartbeat. Nao ha mais estimativa. */
      total_seconds: totalSeconds,
      avg_session_seconds:
        sessions.length > 0 ? Math.round(totalSeconds / sessions.length) : 0,
      /** Contas com sinal recente - quem esta no sistema agora. */
      online_now: new Set(sessions.filter((s) => s.online).map((s) => s.userId)).size,
    };

    // -------------------------------------------- serie temporal de acessos
    const sessionsByPeriod = tally(sessions, (s) => periodKey(s.startedAt, granularity));

    const viewsByPeriod = tally(iframeViews, (r) => periodKey(r.createdAt, granularity));

    const timeline = periods.map((key) => ({
      period: key,
      sessions: sessionsByPeriod.get(key) ?? 0,
      iframe_views: viewsByPeriod.get(key) ?? 0,
    }));

    // ------------------------------------------------- paineis mais acessados
    const viewsByIframe = tally(iframeViews, (r) => r.entityId);

    const topIframes = [...viewsByIframe.entries()]
      .map(([iframeId, views]) => {
        const iframe = iframeById.get(iframeId);
        return {
          iframe_id: iframeId,
          // Painel excluido depois do acesso: o log sobrevive, o cadastro nao.
          title: iframe?.title ?? '(painel excluido)',
          contract_name: iframe?.contract.name ?? null,
          client_name: iframe?.contract.clientName ?? null,
          is_active: iframe?.isActive ?? null,
          views,
          viewers: viewersByIframe.get(iframeId)?.size ?? 0,
        };
      })
      .sort((a, b) => b.views - a.views);

    /**
     * Paineis ATIVOS com zero acesso no periodo. E a leitura mais acionavel
     * do conjunto: mostra o que foi publicado e ninguem abriu.
     */
    const neverAccessed = iframes
      .filter((i) => i.isActive && !viewsByIframe.has(i.id))
      .map((i) => ({
        iframe_id: i.id,
        title: i.title,
        contract_name: i.contract.name,
        client_name: i.contract.clientName,
      }))
      .sort((a, b) => a.contract_name.localeCompare(b.contract_name, 'pt-BR'));

    // ------------------------------------------------------ por usuario
    const perUser = new Map<
      string,
      { sessions: number; seconds: number; last_access: Date | null; online: boolean }
    >();

    for (const s of sessions) {
      const acc =
        perUser.get(s.userId) ??
        { sessions: 0, seconds: 0, last_access: null as Date | null, online: false };

      acc.sessions += 1;
      acc.seconds += s.durationSeconds;
      acc.online = acc.online || s.online;
      if (!acc.last_access || s.lastSeenAt > acc.last_access) acc.last_access = s.lastSeenAt;

      perUser.set(s.userId, acc);
    }

    const viewsByUser = tally(iframeViews, (r) => r.userId);

    const byUser = [...perUser.entries()]
      .map(([userId, acc]) => {
        const user = userById.get(userId);
        return {
          user_id: userId,
          name: user?.name ?? '(conta excluida)',
          email: user?.email ?? null,
          role: user?.role ?? null,
          sessions: acc.sessions,
          seconds: acc.seconds,
          iframe_views: viewsByUser.get(userId) ?? 0,
          last_access: acc.last_access,
          online: acc.online,
        };
      })
      .sort((a, b) => b.seconds - a.seconds || b.sessions - a.sessions);

    // --------------------------------------------------- ultimos acessos
    const lastAccesses = sessions.slice(0, 50).map((s) => ({
      user_id: s.userId,
      name: s.name,
      email: s.email,
      started_at: s.startedAt,
      last_seen_at: s.lastSeenAt,
      duration_seconds: s.durationSeconds,
      online: s.online,
      ip_address: s.ipAddress,
    }));

    // -------------------------------------------------------- por contrato
    const measuredByContract = new Map(
      contractUsage.map((g) => [g.contractId, g._sum.seconds ?? 0]),
    );
    const viewsByContract = tally(iframeViews, (r) => {
      const iframe = r.entityId ? iframeById.get(r.entityId) : undefined;
      return iframe?.contractId ?? null;
    });

    // Quem abriu a tela do contrato (page view), em uma passada.
    const visitorsByContract = new Map<string, Set<string | null>>();
    for (const r of auditRows) {
      const contractId = contractIdFromPath(r.entityId);
      if (!contractId) continue;
      const set = visitorsByContract.get(contractId) ?? new Set<string | null>();
      set.add(r.userId);
      visitorsByContract.set(contractId, set);
    }

    const contractIds = new Set<string>([
      ...measuredByContract.keys(),
      ...viewsByContract.keys(),
      ...visitorsByContract.keys(),
    ]);

    const byContract = [...contractIds]
      .map((contractId) => ({
        contract_id: contractId,
        name: contractById.get(contractId)?.name ?? '(contrato excluido)',
        client_name: contractById.get(contractId)?.clientName ?? null,
        iframe_views: viewsByContract.get(contractId) ?? 0,
        seconds: measuredByContract.get(contractId) ?? 0,
        visitors: visitorsByContract.get(contractId)?.size ?? 0,
      }))
      .sort((a, b) => b.seconds - a.seconds || b.iframe_views - a.iframe_views);

    // ------------------------------------------------- heatmap dia x hora
    // 7 dias (0 = domingo) x 24 horas, no fuso do servidor.
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of auditRows) {
      if (r.action !== AuditAction.PAGE_VIEW && r.action !== AuditAction.IFRAME_VIEW) continue;
      heatmap[r.createdAt.getDay()]![r.createdAt.getHours()] += 1;
    }

    // ------------------------------------- seguranca e contas sem acesso
    const failuresByAccount = [...tally(loginFailures, (r) => r.userEmail ?? r.ipAddress).entries()]
      .map(([key, count]) => ({ identifier: key, attempts: count }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 20);

    /**
     * Ultimo acesso de CADA conta, inclusive fora da janela consultada: uma
     * conta inativa e justamente a que nao aparece no periodo, e dizer
     * "nunca acessou" quando ela acessou no mes passado seria errado.
     */
    const lastLoginPerUser = q.user_id
      ? []
      : await prisma.auditLog.groupBy({
          by: ['userId'],
          where: { action: AuditAction.LOGIN, userId: { not: null } },
          _max: { createdAt: true },
        });
    const lastLoginById = new Map(
      lastLoginPerUser.map((g) => [g.userId!, g._max.createdAt]),
    );

    // "Contas sem acesso" compara contas entre si: com o filtro de uma conta
    // ligado a lista perde sentido, e a tela esconde a secao.
    const inactiveUsers = q.user_id
      ? []
      : users
      .filter((u) => u.isActive)
      .map((u) => ({
        user_id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        last_login: lastLoginById.get(u.id) ?? null,
      }))
      .filter((u) => {
        if (!u.last_login) return true;
        const days = (Date.now() - u.last_login.getTime()) / 86_400_000;
        return days >= q.inactive_days;
      })
      .sort((a, b) => {
        if (!a.last_login) return -1;
        if (!b.last_login) return 1;
        return a.last_login.getTime() - b.last_login.getTime();
      });

    res.json({
      range: { from: dayKey(from), to: dayKey(to), granularity },
      user_id: q.user_id ?? null,
      truncated,
      inactive_days: q.inactive_days,
      summary,
      timeline,
      top_iframes: topIframes,
      never_accessed: neverAccessed,
      by_user: byUser,
      last_accesses: lastAccesses,
      by_contract: byContract,
      heatmap,
      login_failures: failuresByAccount,
      inactive_users: inactiveUsers,
    });
  }),
);
