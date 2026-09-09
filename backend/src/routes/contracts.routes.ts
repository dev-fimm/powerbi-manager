import { Prisma, Role } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import {
  assertContractAccess,
  assertContractWriteAccess,
  getAccessibleContractIds,
  getGrantedIframeIds,
  hasIframeLevelAccess,
  hasFullAccess,
  requireFullAccess,
  requireManager,
} from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { AuditAction, recordLog } from '../utils/audit';
import { NotFoundError } from '../utils/errors';
import { serializeContract, serializeIframe } from '../utils/serialize';
import {
  createContractSchema,
  listContractsQuerySchema,
  updateContractSchema,
  uuidParam,
} from '../validators/schemas';

export const contractRoutes = Router();

contractRoutes.use(authenticate);

/**
 * Monta o `select` dos contadores (_count) conforme o perfil, para que os
 * numeros exibidos nao revelem mais do que a conta pode enxergar:
 *
 *  - ADMIN         -> todos os iframes + total de contas no contrato.
 *  - GESTOR        -> todos os iframes; sem users_count (quantas contas usam o
 *                     contrato e informacao de gestao de acesso, exclusiva de
 *                     ADMIN).
 *  - VISUALIZADOR  -> apenas os paineis ATIVOS que lhe foram concedidos
 *                     individualmente; sem users_count. Antes, este perfil via
 *                     "8 paineis" num contrato onde so tinha acesso a 2.
 */
async function countSelectForUser(user: Express.AuthenticatedUser) {
  if (hasFullAccess(user)) {
    return { iframes: true, users: true } as const;
  }

  if (hasIframeLevelAccess(user)) {
    const grantedIds = await getGrantedIframeIds(user);
    return { iframes: { where: { isActive: true, id: { in: grantedIds } } } };
  }

  return { iframes: true };
}

/**
 * GET /api/contracts
 * ADMIN ve todos; GESTOR e VISUALIZADOR veem apenas os contratos
 * associados em user_contracts (regra 2).
 */
contractRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, search } = listContractsQuerySchema.parse(req.query);
    const accessibleIds = await getAccessibleContractIds(req.user!);

    const where: Prisma.ContractWhereInput = {
      ...(accessibleIds ? { id: { in: accessibleIds } } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { clientName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const contracts = await prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: await countSelectForUser(req.user!) } },
    });

    res.json(contracts.map(serializeContract));
  }),
);

/** GET /api/contracts/:id */
contractRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await assertContractAccess(req.user!, id);

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: { _count: { select: await countSelectForUser(req.user!) } },
    });
    if (!contract) throw new NotFoundError('Contrato nao encontrado.');

    res.json(serializeContract(contract));
  }),
);

/**
 * POST /api/contracts - ADMIN e GESTOR.
 * Quando um GESTOR cria um contrato, ele e automaticamente associado a si mesmo,
 * caso contrario o proprio criador ficaria sem acesso ao que acabou de criar.
 */
contractRoutes.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const data = createContractSchema.parse(req.body);

    const contract = await prisma.contract.create({
      data: {
        name: data.name,
        clientName: data.client_name,
        description: data.description ?? null,
        startDate: data.start_date,
        endDate: data.end_date,
        status: data.status,
        ...(req.user!.role === Role.GESTOR
          ? { users: { create: { userId: req.user!.id } } }
          : {}),
      },
      include: { _count: { select: await countSelectForUser(req.user!) } },
    });

    await recordLog(req, {
      action: AuditAction.CONTRACT_CREATE,
      entity: 'Contract',
      entityId: contract.id,
      description: `Contrato "${contract.name}" (${contract.clientName}) criado.`,
    });

    res.status(201).json(serializeContract(contract));
  }),
);

/**
 * PUT /api/contracts/:id - ADMIN (qualquer) e GESTOR (apenas os seus).
 */
contractRoutes.put(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const data = updateContractSchema.parse(req.body);

    await assertContractWriteAccess(req.user!, id);

    const exists = await prisma.contract.findUnique({ where: { id } });
    if (!exists) throw new NotFoundError('Contrato nao encontrado.');

    const contract = await prisma.contract.update({
      where: { id },
      data: {
        name: data.name,
        clientName: data.client_name,
        ...(data.description !== undefined ? { description: data.description ?? null } : {}),
        startDate: data.start_date,
        endDate: data.end_date,
        status: data.status,
      },
      include: { _count: { select: await countSelectForUser(req.user!) } },
    });

    await recordLog(req, {
      action: AuditAction.CONTRACT_UPDATE,
      entity: 'Contract',
      entityId: contract.id,
      description: `Contrato "${contract.name}" atualizado.`,
    });

    res.json(serializeContract(contract));
  }),
);

/**
 * DELETE /api/contracts/:id - apenas ADMIN.
 * Regra 7 (cascade): os iframes do contrato e os vinculos user_contracts
 * sao removidos automaticamente pelo onDelete: Cascade do schema Prisma.
 */
contractRoutes.delete(
  '/:id',
  requireFullAccess,
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);

    const exists = await prisma.contract.findUnique({ where: { id } });
    if (!exists) throw new NotFoundError('Contrato nao encontrado.');

    await prisma.contract.delete({ where: { id } });

    await recordLog(req, {
      action: AuditAction.CONTRACT_DELETE,
      entity: 'Contract',
      entityId: id,
      description: `Contrato "${exists.name}" (${exists.clientName}) excluido.`,
    });

    res.status(204).send();
  }),
);

/**
 * GET /api/contracts/:id/iframes
 * Lista de iframes de um contrato especifico (visao administrativa:
 * VISUALIZADOR tambem ve somente os ativos).
 */
contractRoutes.get(
  '/:id/iframes',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await assertContractAccess(req.user!, id);

    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundError('Contrato nao encontrado.');

    const onlyActive = req.user!.role === Role.VISUALIZADOR;

    const iframes = await prisma.iframe.findMany({
      where: { contractId: id, ...(onlyActive ? { isActive: true } : {}) },
      orderBy: { createdAt: 'asc' },
    });

    res.json(iframes.map(serializeIframe));
  }),
);
