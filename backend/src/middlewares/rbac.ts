import { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

/**
 * ============================================================
 * CONTROLE DE ACESSO POR ROLE  (regra de negocio 2)
 * ============================================================
 * ADMIN         -> acesso total (usuarios, contratos, iframes).
 * GESTOR        -> gerencia contratos e iframes dos contratos associados a ele.
 *                  Nao gerencia usuarios.
 * VISUALIZADOR  -> apenas leitura dos iframes dos contratos associados.
 */

/** Exige que o usuario logado tenha uma das roles informadas. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());

    if (!roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Acesso negado. Requer perfil: ${roles.join(' ou ')}. Seu perfil: ${req.user.role}.`,
        ),
      );
    }
    next();
  };
}

/** Atalho para rotas exclusivas de ADMIN. */
export const requireAdmin = requireRole(Role.ADMIN);

/** Atalho para rotas de escrita (criar/editar) de contratos e iframes. */
export const requireManager = requireRole(Role.ADMIN, Role.GESTOR);

export const isAdmin = (user?: Express.AuthenticatedUser): boolean =>
  user?.role === Role.ADMIN;

/**
 * Retorna os ids dos contratos que o usuario pode enxergar.
 * ADMIN => null (significa "todos", sem filtro).
 * GESTOR/VISUALIZADOR => lista vinda de user_contracts.
 */
export async function getAccessibleContractIds(
  user: Express.AuthenticatedUser,
): Promise<string[] | null> {
  if (isAdmin(user)) return null;

  const links = await prisma.userContract.findMany({
    where: { userId: user.id },
    select: { contractId: true },
  });

  return links.map((l) => l.contractId);
}

/**
 * true quando o acesso aos iframes deste usuario e restringido por concessao
 * individual (por dashboard). Hoje aplica-se somente ao VISUALIZADOR.
 */
export function hasIframeLevelAccess(user?: Express.AuthenticatedUser): boolean {
  return user?.role === Role.VISUALIZADOR;
}

/** Ids dos iframes (dashboards) concedidos individualmente ao usuario. */
export async function getGrantedIframeIds(
  user: Express.AuthenticatedUser,
): Promise<string[]> {
  const links = await prisma.userIframe.findMany({
    where: { userId: user.id },
    select: { iframeId: true },
  });
  return links.map((l) => l.iframeId);
}

/**
 * Garante que o usuario tem acesso ao contrato informado.
 * Lanca ForbiddenError se o contrato nao estiver associado a ele.
 * ADMIN sempre passa.
 */
export async function assertContractAccess(
  user: Express.AuthenticatedUser,
  contractId: string,
): Promise<void> {
  if (isAdmin(user)) return;

  const link = await prisma.userContract.findUnique({
    where: { userId_contractId: { userId: user.id, contractId } },
    select: { id: true },
  });

  if (!link) {
    throw new ForbiddenError('Voce nao tem acesso a este contrato.');
  }
}

/**
 * Garante que o usuario pode ESCREVER (criar/editar/excluir) no contrato.
 * VISUALIZADOR nunca escreve (regra 2).
 */
export async function assertContractWriteAccess(
  user: Express.AuthenticatedUser,
  contractId: string,
): Promise<void> {
  if (user.role === Role.VISUALIZADOR) {
    throw new ForbiddenError('Perfil VISUALIZADOR nao pode criar, editar ou excluir.');
  }
  await assertContractAccess(user, contractId);
}
