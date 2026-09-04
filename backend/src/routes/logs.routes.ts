import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import { requireAdmin } from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { AuditAction, recordLog } from '../utils/audit';
import { serializeAuditLog } from '../utils/serialize';
import { listLogsQuerySchema, pageViewSchema } from '../validators/schemas';

export const logRoutes = Router();

// Todas as rotas exigem autenticacao.
logRoutes.use(authenticate);

/**
 * POST /api/logs/page-view
 * Registra a tela que o usuario acessou. Disponivel para QUALQUER usuario
 * autenticado (todos navegam telas) - por isso vem antes do guard de ADMIN.
 * Chamado pelo front a cada troca de rota.
 */
logRoutes.post(
  '/page-view',
  asyncHandler(async (req, res) => {
    const { path, label } = pageViewSchema.parse(req.body);
    await recordLog(req, {
      action: AuditAction.PAGE_VIEW,
      entity: 'Screen',
      entityId: path,
      description: `Acessou a tela "${label ?? path}".`,
    });
    res.status(204).send();
  }),
);

// A partir daqui, a consulta da auditoria e restrita a ADMIN (regra 2).
logRoutes.use(requireAdmin);

/**
 * Converte "yyyy-mm-dd" em Date. Para o limite superior (to) usa o fim do dia
 * para que o filtro seja inclusivo no dia inteiro selecionado.
 */
function parseDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const iso = value.length <= 10 ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * GET /api/logs
 * Lista paginada dos logs de auditoria, do mais recente para o mais antigo.
 * Filtros: action, user_id, search (nome/e-mail/descricao), from, to.
 */
logRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listLogsQuerySchema.parse(req.query);

    const from = parseDate(q.from, false);
    const to = parseDate(q.to, true);

    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.user_id ? { userId: q.user_id } : {}),
      ...(q.search
        ? {
            OR: [
              { userName: { contains: q.search, mode: 'insensitive' } },
              { userEmail: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.page_size,
        take: q.page_size,
      }),
    ]);

    res.json({
      data: rows.map(serializeAuditLog),
      page: q.page,
      page_size: q.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / q.page_size)),
    });
  }),
);
