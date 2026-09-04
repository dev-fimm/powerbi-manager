import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import { requireAdmin } from '../middlewares/rbac';
import { hasIframeLevelAccess } from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { AuditAction, recordLog } from '../utils/audit';
import { AppError, ConflictError, NotFoundError } from '../utils/errors';
import {
  defaultScreensForRole,
  sanitizeManageableScreens,
} from '../utils/screens';
import { serializeUser } from '../utils/serialize';
import {
  createUserSchema,
  setUserContractsSchema,
  setUserIframesSchema,
  setUserScreensSchema,
  updateUserSchema,
  uuidParam,
} from '../validators/schemas';

export const userRoutes = Router();

// Todas as rotas de usuario exigem autenticacao + perfil ADMIN (regra 2).
userRoutes.use(authenticate, requireAdmin);

/** GET /api/users */
userRoutes.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { contracts: { include: { contract: true } } },
    });
    res.json(users.map(serializeUser));
  }),
);

/** GET /api/users/:id */
userRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);

    const user = await prisma.user.findUnique({
      where: { id },
      include: { contracts: { include: { contract: true } } },
    });
    if (!user) throw new NotFoundError('Usuario nao encontrado.');

    res.json(serializeUser(user));
  }),
);

/** POST /api/users */
userRoutes.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createUserSchema.parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictError('Ja existe um usuario com este e-mail.');

    const passwordHash = await bcrypt.hash(data.password, env.bcryptSaltRounds);

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        isActive: data.isActive,
        // Telas iniciais conforme o perfil; ajustaveis depois na tela de Permissoes.
        allowedScreens: defaultScreensForRole(data.role),
        contracts: data.contractIds?.length
          ? { create: data.contractIds.map((contractId) => ({ contractId })) }
          : undefined,
      },
      include: { contracts: { include: { contract: true } } },
    });

    await recordLog(req, {
      action: AuditAction.USER_CREATE,
      entity: 'User',
      entityId: user.id,
      description: `Usuario "${user.name}" (${user.email}) criado com perfil ${user.role}.`,
    });

    res.status(201).json(serializeUser(user));
  }),
);

/** PUT /api/users/:id */
userRoutes.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const data = updateUserSchema.parse(req.body);

    const current = await prisma.user.findUnique({ where: { id } });
    if (!current) throw new NotFoundError('Usuario nao encontrado.');

    if (data.email && data.email !== current.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: data.email } });
      if (emailTaken) throw new ConflictError('Ja existe um usuario com este e-mail.');
    }

    // Impede que o admin logado se rebaixe ou se desative e perca o acesso.
    if (id === req.user!.id) {
      if (data.role && data.role !== current.role) {
        throw new AppError('Voce nao pode alterar o proprio perfil de acesso.', 400);
      }
      if (data.isActive === false) {
        throw new AppError('Voce nao pode desativar o proprio usuario.', 400);
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        isActive: data.isActive,
        // A senha so e re-hasheada quando enviada.
        ...(data.password
          ? { passwordHash: await bcrypt.hash(data.password, env.bcryptSaltRounds) }
          : {}),
      },
      include: { contracts: { include: { contract: true } } },
    });

    await recordLog(req, {
      action: AuditAction.USER_UPDATE,
      entity: 'User',
      entityId: user.id,
      description: `Usuario "${user.name}" (${user.email}) atualizado.`,
    });

    res.json(serializeUser(user));
  }),
);

/**
 * DELETE /api/users/:id
 * Regra 7: excluir o usuario remove as associacoes em user_contracts
 * (onDelete: Cascade no schema) mas NAO exclui nenhum contrato.
 */
userRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);

    if (id === req.user!.id) {
      throw new AppError('Voce nao pode excluir o proprio usuario.', 400);
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('Usuario nao encontrado.');

    await prisma.user.delete({ where: { id } });

    await recordLog(req, {
      action: AuditAction.USER_DELETE,
      entity: 'User',
      entityId: id,
      description: `Usuario "${user.name}" (${user.email}) excluido.`,
    });

    res.status(204).send();
  }),
);

/**
 * PUT /api/users/:id/contracts
 * Substitui a lista de contratos associados ao usuario.
 * Body: { contract_ids: string[] }
 */
userRoutes.put(
  '/:id/contracts',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { contract_ids: contractIds } = setUserContractsSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('Usuario nao encontrado.');

    // Valida que todos os contratos informados existem antes de gravar.
    if (contractIds.length > 0) {
      const found = await prisma.contract.findMany({
        where: { id: { in: contractIds } },
        select: { id: true },
      });
      if (found.length !== new Set(contractIds).size) {
        throw new NotFoundError('Um ou mais contratos informados nao existem.');
      }
    }

    // Transacao: apaga os vinculos atuais e recria os novos.
    await prisma.$transaction([
      prisma.userContract.deleteMany({ where: { userId: id } }),
      prisma.userContract.createMany({
        data: Array.from(new Set(contractIds)).map((contractId) => ({
          userId: id,
          contractId,
        })),
        skipDuplicates: true,
      }),
    ]);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { contracts: { include: { contract: true } } },
    });

    await recordLog(req, {
      action: AuditAction.USER_CONTRACTS,
      entity: 'User',
      entityId: id,
      description: `Contratos do usuario "${updated.name}" atualizados (${contractIds.length} associado(s)).`,
    });

    res.json(serializeUser(updated));
  }),
);

/**
 * PUT /api/users/:id/screens
 * Define as telas que a conta pode acessar no frontend (regra de negocio:
 * gestao de acesso por conta). O ADMIN acessa todas as telas e nao pode ser
 * restringido. Body: { screens: string[] }
 */
userRoutes.put(
  '/:id/screens',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { screens } = setUserScreensSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('Usuario nao encontrado.');

    if (user.role === Role.ADMIN) {
      throw new AppError(
        'O perfil ADMIN acessa todas as telas e nao pode ser restringido.',
        400,
      );
    }

    const clean = sanitizeManageableScreens(screens);

    const updated = await prisma.user.update({
      where: { id },
      data: { allowedScreens: clean },
      include: { contracts: { include: { contract: true } } },
    });

    await recordLog(req, {
      action: AuditAction.USER_SCREENS,
      entity: 'User',
      entityId: id,
      description: `Telas do usuario "${updated.name}" atualizadas (${clean.length} liberada(s)).`,
    });

    res.json(serializeUser(updated));
  }),
);

/**
 * GET /api/users/:id/iframes
 * Ids dos dashboards (iframes) concedidos individualmente a esta conta.
 * Usado pela tela de Permissoes para montar a distribuicao de acesso.
 */
userRoutes.get(
  '/:id/iframes',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('Usuario nao encontrado.');

    const grants = await prisma.userIframe.findMany({
      where: { userId: id },
      select: { iframeId: true },
    });

    res.json({ iframe_ids: grants.map((g) => g.iframeId) });
  }),
);

/**
 * PUT /api/users/:id/iframes
 * Substitui a lista de dashboards concedidos a conta (acesso por dashboard).
 * So faz sentido para VISUALIZADOR - os demais perfis nao sao restringidos
 * por dashboard (GESTOR ve os do contrato; ADMIN ve todos).
 * Body: { iframe_ids: string[] }
 */
userRoutes.put(
  '/:id/iframes',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { iframe_ids: iframeIds } = setUserIframesSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('Usuario nao encontrado.');

    if (!hasIframeLevelAccess(user)) {
      throw new AppError(
        'A concessao por dashboard so se aplica ao perfil VISUALIZADOR. ' +
          'GESTOR ve os paineis dos contratos associados e ADMIN ve todos.',
        400,
      );
    }

    const uniqueIds = Array.from(new Set(iframeIds));

    // Valida que todos os iframes informados existem antes de gravar.
    if (uniqueIds.length > 0) {
      const found = await prisma.iframe.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (found.length !== uniqueIds.length) {
        throw new NotFoundError('Um ou mais paineis informados nao existem.');
      }
    }

    // Transacao: remove os vinculos atuais e recria os novos.
    await prisma.$transaction([
      prisma.userIframe.deleteMany({ where: { userId: id } }),
      prisma.userIframe.createMany({
        data: uniqueIds.map((iframeId) => ({ userId: id, iframeId })),
        skipDuplicates: true,
      }),
    ]);

    await recordLog(req, {
      action: AuditAction.USER_IFRAMES,
      entity: 'User',
      entityId: id,
      description: `Dashboards do usuario "${user.name}" atualizados (${uniqueIds.length} concedido(s)).`,
    });

    res.json({ iframe_ids: uniqueIds });
  }),
);
