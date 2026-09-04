import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { UnauthorizedError } from '../utils/errors';

export interface JwtPayload {
  sub: string; // id do usuario
  role: string;
  email: string;
}

/**
 * ============================================================
 * MIDDLEWARE DE AUTENTICACAO JWT  (regra de negocio 1)
 * ============================================================
 * Toda rota da API passa por aqui, exceto POST /api/auth/login.
 *
 * Fluxo:
 *  1. Le o header Authorization no formato "Bearer <token>".
 *  2. Verifica assinatura e expiracao com o JWT_SECRET.
 *  3. Recarrega o usuario do banco a cada requisicao. Isso e proposital:
 *     garante que um usuario desativado (is_active = false) ou excluido
 *     perca o acesso imediatamente, sem precisar esperar o token expirar.
 *  4. Anexa o usuario em req.user para os middlewares/rotas seguintes.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;

    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedError('Token de autenticacao ausente.');
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new UnauthorizedError('Token de autenticacao ausente.');
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Sessao expirada. Faca login novamente.');
      }
      throw new UnauthorizedError('Token invalido.');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedError('Usuario do token nao existe mais.');
    }

    // Usuario desativado nao consegue usar nenhuma rota autenticada.
    if (!user.isActive) {
      throw new UnauthorizedError('Usuario inativo. Contate o administrador.');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Gera o token JWT de um usuario autenticado. */
export function signToken(user: { id: string; role: string; email: string }): string {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email } satisfies JwtPayload,
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] },
  );
}
