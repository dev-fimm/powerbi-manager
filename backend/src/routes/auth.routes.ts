import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { authenticate, signToken } from '../middlewares/auth';
import { assertCanAssignRole, requireFullAccess } from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { AuditAction, recordLog } from '../utils/audit';
import { AppError, ConflictError, UnauthorizedError } from '../utils/errors';
import { checkPasswordPolicy } from '../utils/password';
import { defaultScreensForRole } from '../utils/screens';
import { serializeUser } from '../utils/serialize';
import { changePasswordSchema, loginSchema, registerSchema } from '../validators/schemas';

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
  requireFullAccess,
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = registerSchema.parse(req.body);

    // DESENVOLVEDOR nao pode criar contas ADMIN (ver rbac.assertCanAssignRole).
    assertCanAssignRole(req.user!, role);

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictError('Ja existe um usuario com este e-mail.');

    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

    const effectiveRole = role ?? Role.VISUALIZADOR;

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: effectiveRole,
        // Mesmas telas iniciais de POST /users. Sem isto a coluna caia no
        // default [] do schema e a conta nascia SEM nenhuma tela - o login
        // funcionava, mas nao havia para onde navegar depois dele.
        allowedScreens: defaultScreensForRole(effectiveRole),
      },
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

/**
 * POST /api/auth/change-password
 * Troca de senha pelo PROPRIO usuario (qualquer perfil).
 *
 * Antes desta rota, so um ADMIN conseguia trocar senhas - o que obrigava o
 * usuario a entregar a senha a um terceiro e deixava o admin conhecendo a
 * credencial de todo mundo.
 *
 * Exige a senha atual mesmo com a sessao ja autenticada: e o que impede que
 * um token roubado seja convertido em posse permanente da conta.
 */
authRoutes.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { current_password: currentPassword, new_password: newPassword } =
      changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      await recordLog(req, {
        action: AuditAction.LOGIN_FAILED,
        entity: 'User',
        entityId: user.id,
        description: 'Troca de senha recusada: senha atual incorreta.',
      });
      throw new UnauthorizedError('Senha atual incorreta.');
    }

    // A senha nova nao pode conter o nome/e-mail do dono da conta.
    const personal = checkPasswordPolicy(newPassword, user).filter((i) => i.code === 'personal');
    if (personal.length > 0) {
      throw new AppError(personal[0]!.message, 422);
    }

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new AppError('A nova senha deve ser diferente da senha atual.', 422);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, env.bcryptSaltRounds) },
    });

    await recordLog(req, {
      action: AuditAction.PASSWORD_CHANGE,
      entity: 'User',
      entityId: user.id,
      description: 'Senha alterada pelo proprio usuario.',
    });

    // O JWT continua valido ate expirar (ele nao guarda a senha). Trocar a
    // senha nao encerra as demais sessoes - ver nota em docs/DOCUMENTATION.md.
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
