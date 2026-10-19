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
import {
  assertNotBlocked,
  blockedError,
  clearAttempts,
  clientIp,
  registerFailedAttempt,
  unlockAccount,
} from '../utils/loginThrottle';
import { checkPasswordPolicy } from '../utils/password';
import { defaultScreensForRole } from '../utils/screens';
import { serializeUser } from '../utils/serialize';
import { changePasswordSchema, loginSchema, registerSchema } from '../validators/schemas';

export const authRoutes = Router();

/**
 * Hash descartavel usado quando o e-mail nao existe.
 *
 * Sem ele, a resposta para e-mail inexistente volta na hora e a de senha
 * errada demora o tempo do bcrypt - diferenca de tempo suficiente para
 * descobrir quais e-mails estao cadastrados, mesmo com a mensagem identica.
 * Comparar contra um hash qualquer iguala o custo das duas respostas.
 */
const DUMMY_HASH = bcrypt.hashSync('senha-que-nunca-sera-usada', env.bcryptSaltRounds);

/** Mensagem unica de credencial recusada (ver bloco de seguranca abaixo). */
const INVALID_CREDENTIALS = 'Usuario ou senha invalidos.';

/**
 * POST /api/auth/login
 * UNICA rota publica da API (regra 1).
 *
 * ============================================================
 * SEGURANCA DESTE ENDPOINT
 * ============================================================
 * - Protecao contra forca bruta (utils/loginThrottle.ts): o bloqueio e
 *   checado ANTES da senha, entao durante o bloqueio nem a credencial certa
 *   entra.
 * - Mensagem unica para e-mail inexistente, senha errada E conta inativa.
 *   As duas primeiras ja eram iguais; a de conta inativa dizia "usuario
 *   inativo" e, com isso, confirmava que aquele e-mail existia. O motivo
 *   real continua gravado na auditoria, onde so o administrador le.
 * - Custo de tempo equalizado entre e-mail existente e inexistente
 *   (DUMMY_HASH acima).
 */
authRoutes.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const ip = clientIp(req);

    // Regra 2: bloqueado nao passa, nem com a senha correta.
    await assertNotBlocked(email, ip);

    const user = await prisma.user.findUnique({ where: { email } });

    // Compara sempre, mesmo sem usuario, para o tempo de resposta nao
    // denunciar a existencia da conta.
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    const failureReason = !user
      ? `Tentativa de login com e-mail inexistente: ${email}.`
      : !passwordMatches
        ? 'Tentativa de login com senha incorreta.'
        : !user.isActive
          ? 'Tentativa de login de usuario inativo.'
          : null;

    if (failureReason) {
      await recordLog(req, {
        action: AuditAction.LOGIN_FAILED,
        actor: user ?? { email },
        description: failureReason,
      });

      // Contabiliza e, se estourar o limite, bloqueia e registra o bloqueio.
      const blocked = await registerFailedAttempt(req, email, ip, user);

      // Foi ESTA tentativa que estourou o limite: responde ja o 429, em vez
      // de 401 agora e 429 so na proxima.
      if (blocked) throw blockedError(blocked);

      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    // Regra 3: sucesso zera os contadores.
    await clearAttempts(email, ip);

    const token = signToken(user!);

    await recordLog(req, {
      action: AuditAction.LOGIN,
      actor: user!,
      description: 'Login realizado com sucesso.',
    });

    res.json({ token, user: serializeUser(user!) });
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

    // Redefinir a senha e o caminho de volta do bloqueio por forca bruta -
    // inclusive do degrau que exige liberacao manual.
    await unlockAccount(user.email);

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
