import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { authenticate, signToken } from '../middlewares/auth';
import { requireAdmin } from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { AuditAction, recordLog } from '../utils/audit';
import { ConflictError, UnauthorizedError } from '../utils/errors';
import { serializeUser } from '../utils/serialize';
import { loginSchema, registerSchema } from '../validators/schemas';

export const authRoutes = Router();

/**
 * POST /api/auth/login
 * UNICA rota publica da API (regra 1).
 *
 * Observacao de seguranca: a mensagem de erro e a mesma para e-mail
 * inexistente e senha errada, para nao revelar quais e-mails existem.
 */
authRoutes.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      await recordLog(req, {
        action: AuditAction.LOGIN_FAILED,
        actor: { email },
        description: `Tentativa de login com e-mail inexistente: ${email}.`,
      });
      throw new UnauthorizedError('E-mail ou senha invalidos.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      await recordLog(req, {
        action: AuditAction.LOGIN_FAILED,
        actor: user,
        description: 'Tentativa de login com senha incorreta.',
      });
      throw new UnauthorizedError('E-mail ou senha invalidos.');
    }

    if (!user.isActive) {
      await recordLog(req, {
        action: AuditAction.LOGIN_FAILED,
        actor: user,
        description: 'Tentativa de login de usuario inativo.',
      });
      throw new UnauthorizedError('Usuario inativo. Contate o administrador.');
    }

    const token = signToken(user);

    await recordLog(req, {
      action: AuditAction.LOGIN,
      actor: user,
      description: 'Login realizado com sucesso.',
    });

    res.json({ token, user: serializeUser(user) });
  }),
);

/**
 * POST /api/auth/register
 * Apenas ADMIN autenticado pode registrar novos usuarios.
 */
authRoutes.post(
  '/register',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = registerSchema.parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictError('Ja existe um usuario com este e-mail.');

    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: role ?? Role.VISUALIZADOR },
    });

    await recordLog(req, {
      action: AuditAction.USER_CREATE,
      entity: 'User',
      entityId: user.id,
      description: `Usuario "${user.name}" (${user.email}) registrado com perfil ${user.role}.`,
    });

    const token = signToken(user);

    res.status(201).json({ token, user: serializeUser(user) });
  }),
);

/**
 * POST /api/auth/logout
 * O JWT e stateless, entao o logout de fato acontece no cliente (descarta o token).
 * Esta rota existe apenas para registrar o evento na auditoria.
 */
authRoutes.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await recordLog(req, {
      action: AuditAction.LOGOUT,
      description: 'Logout realizado.',
    });
    res.status(204).send();
  }),
);

/** GET /api/auth/me - retorna o usuario do token (usado pelo front no boot). */
authRoutes.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({ user: serializeUser(user) });
  }),
);
