import type { Request } from 'express';
import { prisma } from '../lib/prisma';

/**
 * ============================================================
 * REGISTRO DE AUDITORIA
 * ============================================================
 * Grava uma linha em audit_logs para cada acao relevante dos usuarios.
 * Consumido pela tela de Logs (GET /api/logs, exclusiva de ADMIN).
 *
 * Regra importante: registrar log NUNCA pode quebrar a requisicao
 * principal. Por isso recordLog engole os proprios erros (apenas loga
 * no console) - se a auditoria falhar, a acao do usuario continua valida.
 */

/** Acoes conhecidas. String em vez de enum para nao exigir migracao a cada nova acao. */
export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PAGE_VIEW: 'PAGE_VIEW',
  /** O proprio usuario trocou a senha informando a senha atual. */
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  /** Um ADMIN redefiniu a senha de outra conta. */
  PASSWORD_RESET: 'PASSWORD_RESET',
  /** Expurgo automatico de logs vencidos (politica de retencao). */
  AUDIT_PURGE: 'AUDIT_PURGE',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  USER_CONTRACTS: 'USER_CONTRACTS',
  USER_SCREENS: 'USER_SCREENS',
  USER_IFRAMES: 'USER_IFRAMES',
  CONTRACT_CREATE: 'CONTRACT_CREATE',
  CONTRACT_UPDATE: 'CONTRACT_UPDATE',
  CONTRACT_DELETE: 'CONTRACT_DELETE',
  IFRAME_CREATE: 'IFRAME_CREATE',
  IFRAME_UPDATE: 'IFRAME_UPDATE',
  IFRAME_DELETE: 'IFRAME_DELETE',
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

interface Actor {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

interface LogInput {
  action: AuditActionType | string;
  entity?: string;
  entityId?: string | null;
  description?: string;
  /** Quem executou a acao. Se omitido, usa req.user (usuario autenticado). */
  actor?: Actor;
}

/** Extrai o IP do cliente, respeitando proxies (X-Forwarded-For). */
function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

export async function recordLog(req: Request, input: LogInput): Promise<void> {
  try {
    const actor: Actor | undefined = input.actor ?? req.user;
    const userAgent = req.headers['user-agent'];

    await prisma.auditLog.create({
      data: {
        userId: actor?.id ?? null,
        userName: actor?.name ?? null,
        userEmail: actor?.email ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        description: input.description ?? null,
        ipAddress: getClientIp(req),
        userAgent: typeof userAgent === 'string' ? userAgent : null,
      },
    });
  } catch (err) {
    // Auditoria nunca deve derrubar a requisicao principal.
    console.error('[audit] falha ao registrar log:', err);
  }
}
