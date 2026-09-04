import { Prisma, Role } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import {
  assertContractAccess,
  assertContractWriteAccess,
  getAccessibleContractIds,
  requireManager,
} from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { AuditAction, recordLog } from '../utils/audit';
import { NotFoundError } from '../utils/errors';
import { normalizePowerBiUrl } from '../utils/powerbi';
import { serializeIframe } from '../utils/serialize';
import {
  createIframeSchema,
  listIframesQuerySchema,
  updateIframeSchema,
  uuidParam,
} from '../validators/schemas';

export const iframeRoutes = Router();

iframeRoutes.use(authenticate);

/**
 * GET /api/iframes
 * Sempre filtrado pelos contratos que o usuario pode acessar.
 * VISUALIZADOR ve apenas iframes ativos (regra 2 + regra 5).
 */
iframeRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listIframesQuerySchema.parse(req.query);
    const accessibleIds = await getAccessibleContractIds(req.user!);

    // Se o usuario pediu um contrato especifico, ele precisa ter acesso a ele.
    if (query.contract_id) {
      await assertContractAccess(req.user!, query.contract_id);
    }

    const where: Prisma.IframeWhereInput = {
      ...(accessibleIds ? { contractId: { in: accessibleIds } } : {}),
      ...(query.contract_id ? { contractId: query.contract_id } : {}),
      ...(query.is_active !== undefined ? { isActive: query.is_active } : {}),
      ...(req.user!.role === Role.VISUALIZADOR ? { isActive: true } : {}),
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const iframes = await prisma.iframe.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { contract: true },
    });

    res.json(iframes.map(serializeIframe));
  }),
);

/** GET /api/iframes/:id */
iframeRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);

    const iframe = await prisma.iframe.findUnique({
      where: { id },
      include: { contract: true },
    });
    if (!iframe) throw new NotFoundError('Iframe nao encontrado.');

    await assertContractAccess(req.user!, iframe.contractId);

    if (req.user!.role === Role.VISUALIZADOR && !iframe.isActive) {
      throw new NotFoundError('Iframe nao encontrado.');
    }

    res.json(serializeIframe(iframe));
  }),
);

/**
 * POST /api/iframes
 * A URL ja foi validada pelo zod (regra 4). Aqui garantimos que o contrato
 * existe e que o usuario tem permissao de escrita nele (regra 3).
 */
iframeRoutes.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const data = createIframeSchema.parse(req.body);

    const contract = await prisma.contract.findUnique({
      where: { id: data.contract_id },
    });
    if (!contract) throw new NotFoundError('Contrato informado nao existe.');

    await assertContractWriteAccess(req.user!, data.contract_id);

    const iframe = await prisma.iframe.create({
      data: {
        title: data.title,
        powerBiUrl: normalizePowerBiUrl(data.power_bi_url),
        description: data.description ?? null,
        contractId: data.contract_id,
        isActive: data.is_active,
      },
      include: { contract: true },
    });

    await recordLog(req, {
      action: AuditAction.IFRAME_CREATE,
      entity: 'Iframe',
      entityId: iframe.id,
      description: `Iframe "${iframe.title}" criado no contrato "${iframe.contract.name}".`,
    });

    res.status(201).json(serializeIframe(iframe));
  }),
);

/** PUT /api/iframes/:id */
iframeRoutes.put(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const data = updateIframeSchema.parse(req.body);

    const current = await prisma.iframe.findUnique({ where: { id } });
    if (!current) throw new NotFoundError('Iframe nao encontrado.');

    // Precisa ter acesso ao contrato de origem...
    await assertContractWriteAccess(req.user!, current.contractId);

    // ...e tambem ao contrato de destino, caso esteja movendo o iframe.
    if (data.contract_id && data.contract_id !== current.contractId) {
      const target = await prisma.contract.findUnique({ where: { id: data.contract_id } });
      if (!target) throw new NotFoundError('Contrato de destino nao existe.');
      await assertContractWriteAccess(req.user!, data.contract_id);
    }

    const iframe = await prisma.iframe.update({
      where: { id },
      data: {
        title: data.title,
        ...(data.power_bi_url
          ? { powerBiUrl: normalizePowerBiUrl(data.power_bi_url) }
          : {}),
        ...(data.description !== undefined ? { description: data.description ?? null } : {}),
        contractId: data.contract_id,
        isActive: data.is_active,
      },
      include: { contract: true },
    });

    await recordLog(req, {
      action: AuditAction.IFRAME_UPDATE,
      entity: 'Iframe',
      entityId: iframe.id,
      description: `Iframe "${iframe.title}" atualizado.`,
    });

    res.json(serializeIframe(iframe));
  }),
);

/** DELETE /api/iframes/:id */
iframeRoutes.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);

    const current = await prisma.iframe.findUnique({ where: { id } });
    if (!current) throw new NotFoundError('Iframe nao encontrado.');

    await assertContractWriteAccess(req.user!, current.contractId);

    await prisma.iframe.delete({ where: { id } });

    await recordLog(req, {
      action: AuditAction.IFRAME_DELETE,
      entity: 'Iframe',
      entityId: id,
      description: `Iframe "${current.title}" excluido.`,
    });

    res.status(204).send();
  }),
);
