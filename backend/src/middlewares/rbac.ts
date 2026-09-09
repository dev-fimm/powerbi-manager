import { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

/**
 * ============================================================
 * CONTROLE DE ACESSO POR ROLE  (regra de negocio 2)
 * ============================================================
 * ADMIN         -> acesso total (usuarios, contratos, iframes).
 * DESENVOLVEDOR -> os mesmos acessos do ADMIN, com UMA restricao: nao altera
 *                  nem remove contas ADMIN (ver assertCanManageUser abaixo).
 * GESTOR        -> gerencia contratos e iframes dos contratos associados a ele.
 *                  Nao gerencia usuarios.
 * VISUALIZADOR  -> apenas leitura dos iframes dos contratos associados.
 */

/**
 * Perfis com acesso total ao sistema. Tudo que hoje pergunta "e ADMIN?" para
 * decidir alcance de dados (todos os contratos, contadores de usuarios, telas
 * de gestao) deve perguntar isto - o DESENVOLVEDOR enxerga o mesmo que o ADMIN.
 * O que os separa e apenas quem pode escrever numa conta ADMIN.
 */
export const FULL_ACCESS_ROLES: readonly Role[] = [Role.ADMIN, Role.DESENVOLVEDOR];

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

/** Atalho para rotas de gestao (ADMIN e DESENVOLVEDOR). */
export const requireFullAccess = requireRole(Role.ADMIN, Role.DESENVOLVEDOR);

/** Atalho para rotas de escrita (criar/editar) de contratos e iframes. */
export const requireManager = requireRole(Role.ADMIN, Role.DESENVOLVEDOR, Role.GESTOR);

/** true para os perfis que enxergam e gerenciam o sistema inteiro. */
export const hasFullAccess = (user?: Express.AuthenticatedUser): boolean =>
  user !== undefined && FULL_ACCESS_ROLES.includes(user.role);

/**
 * ============================================================
 * PROTECAO DAS CONTAS ADMIN
 * ============================================================
 * A unica diferenca entre DESENVOLVEDOR e ADMIN: o DESENVOLVEDOR nao pode
 * tocar em nenhuma conta ADMIN - nem alterar (perfil, senha, status, contratos,
 * telas) nem excluir.
 *
 * Sem isto o perfil seria apenas um segundo ADMIN: bastaria trocar a senha de
 * um administrador, ou rebaixa-lo, para tomar o lugar dele. A trilha de
 * auditoria tambem depende disso - agir como outra pessoa comeca por conseguir
 * escrever na conta dela.
 */
export function canManageUser(
  actor: Express.AuthenticatedUser,
  target: { role: Role },
): boolean {
  if (actor.role === Role.DESENVOLVEDOR && target.role === Role.ADMIN) return false;
  return true;
}

/** Versao que lanca. Usada nas rotas de escrita de /users. */
export function assertCanManageUser(
  actor: Express.AuthenticatedUser,
  target: { role: Role },
): void {
  if (!canManageUser(actor, target)) {
    throw new ForbiddenError(
      'O perfil DESENVOLVEDOR nao pode alterar nem remover contas ADMIN.',
    );
  }
}

/**
 * Conceder o perfil ADMIN e, na pratica, criar uma conta que o DESENVOLVEDOR
 * nao podera mais gerenciar - mas cuja senha ele acabou de definir. Sem este
 * bloqueio, a protecao acima seria contornavel em dois passos: crio um ADMIN,
 * entro com ele, e ai altero os demais administradores.
 */
export function assertCanAssignRole(
  actor: Express.AuthenticatedUser,
  role: Role | undefined,
): void {
  if (role === Role.ADMIN && actor.role === Role.DESENVOLVEDOR) {
    throw new ForbiddenError(
      'O perfil DESENVOLVEDOR nao pode conceder o perfil ADMIN a nenhuma conta.',
    );
  }
}

/**
 * Retorna os ids dos contratos que o usuario pode enxergar.
 * ADMIN/DESENVOLVEDOR => null (significa "todos", sem filtro).
 * GESTOR/VISUALIZADOR => lista vinda de user_contracts.
 */
export async function getAccessibleContractIds(
  user: Express.AuthenticatedUser,
): Promise<string[] | null> {
  if (hasFullAccess(user)) return null;

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
 * ADMIN e DESENVOLVEDOR sempre passam.
 */
export async function assertContractAccess(
  user: Express.AuthenticatedUser,
  contractId: string,
): Promise<void> {
  if (hasFullAccess(user)) return;

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
