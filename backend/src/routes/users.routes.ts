import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import {
  FULL_ACCESS_ROLES,
  assertCanAssignRole,
  assertCanManageUser,
  hasIframeLevelAccess,
  requireFullAccess,
} from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { AuditAction, recordLog } from '../utils/audit';
import { AppError, ConflictError, NotFoundError, UnauthorizedError } from '../utils/errors';
import { checkPasswordPolicy } from '../utils/password';
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

// Todas as rotas de usuario exigem autenticacao + perfil de gestao (regra 2):
// ADMIN ou DESENVOLVEDOR. O que o DESENVOLVEDOR nao pode e escrever numa conta
// ADMIN - cada rota de escrita abaixo chama assertCanManageUser.
userRoutes.use(authenticate, requireFullAccess);

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

    assertCanAssignRole(req.user!, data.role);

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

    // DESENVOLVEDOR nao escreve em conta ADMIN, nem promove ninguem a ADMIN.
    assertCanManageUser(req.user!, current);
    assertCanAssignRole(req.user!, data.role);

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

    /**
     * Rebaixar uma conta de acesso total (ADMIN/DESENVOLVEDOR) para
     * GESTOR/VISUALIZADOR.
     *
     * A conta guarda em allowed_screens a lista completa de telas. Ao perder o
     * perfil, effectiveScreens passaria a filtrar essa lista pelas telas
     * configuraveis e devolveria as QUATRO (dashboard, contracts, iframes,
     * viewer) - contornando a regra de que conta sem acesso total comeca apenas
     * com Paineis. Redefine para o padrao do novo perfil; o resto se libera
     * explicitamente na tela de Permissoes.
     */
    const demotedFromFullAccess =
      data.role !== undefined &&
      FULL_ACCESS_ROLES.includes(current.role) &&
      !FULL_ACCESS_ROLES.includes(data.role);

    if (data.password) {
      // A senha nao pode conter o nome/e-mail da conta alvo (usa os valores
      // que ficarao gravados, ja considerando o que veio no payload).
      const personal = checkPasswordPolicy(data.password, {
        name: data.name ?? current.name,
        email: data.email ?? current.email,
      }).filter((i) => i.code === 'personal');

      if (personal.length > 0) throw new AppError(personal[0]!.message, 422);

      /**
       * Reautenticacao para redefinir a senha de uma conta de acesso total
       * (ADMIN ou DESENVOLVEDOR).
       *
       * Sem isto, quem gerencia usuarios assumia a conta de outro apenas
       * trocando a senha dele - escalada lateral silenciosa entre contas
       * privilegiadas, e o bastante para fraudar a trilha de auditoria agindo
       * como outra pessoa. Contas GESTOR/VISUALIZADOR seguem no fluxo normal
       * de reset.
       */
      if (FULL_ACCESS_ROLES.includes(current.role)) {
        if (!data.current_password) {
          throw new AppError(
            'Para redefinir a senha de uma conta de gestao, confirme a sua propria senha.',
            403,
          );
        }

        const actor = await prisma.user.findUniqueOrThrow({
          where: { id: req.user!.id },
          select: { passwordHash: true },
        });

        if (!(await bcrypt.compare(data.current_password, actor.passwordHash))) {
          await recordLog(req, {
            action: AuditAction.LOGIN_FAILED,
            entity: 'User',
            entityId: id,
            description: `Reautenticacao incorreta ao tentar redefinir a senha da conta de gestao "${current.name}".`,
          });
          throw new UnauthorizedError('Sua senha de confirmacao esta incorreta.');
        }
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
        ...(demotedFromFullAccess
          ? { allowedScreens: defaultScreensForRole(data.role!) }
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

    // Reset de senha vira um evento proprio na auditoria: e o tipo de acao
    // que precisa ser encontravel sem depender de ler descricoes.
    if (data.password) {
      await recordLog(req, {
        action: AuditAction.PASSWORD_RESET,
        entity: 'User',
        entityId: user.id,
        description: `Senha da conta "${user.name}" (${user.email}) redefinida por um administrador.`,
      });
    }

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

    assertCanManageUser(req.user!, user);

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

    assertCanManageUser(req.user!, user);

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

    assertCanManageUser(req.user!, user);

    if (FULL_ACCESS_ROLES.includes(user.role)) {
      throw new AppError(
        `O perfil ${user.role} acessa todas as telas e nao pode ser restringido.`,
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

    assertCanManageUser(req.user!, user);

    if (!hasIframeLevelAccess(user)) {
      throw new AppError(
        'A concessao por dashboard so se aplica ao perfil VISUALIZADOR. ' +
          'GESTOR ve os paineis dos contratos associados; ADMIN e DESENVOLVEDOR veem todos.',
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
