import type { Role, User } from '../types';

/**
 * ============================================================
 * PERFIS DE ACESSO (frontend)
 * ============================================================
 * Espelha backend/src/middlewares/rbac.ts. Aqui so controla o que a interface
 * mostra ou desabilita - a autorizacao de verdade e a do backend, que valida
 * as mesmas regras em cada rota.
 */

/** Perfis que enxergam e gerenciam o sistema inteiro. */
export const FULL_ACCESS_ROLES: Role[] = ['ADMIN', 'DESENVOLVEDOR'];

export function hasFullAccessRole(role: Role | undefined): boolean {
  return role !== undefined && FULL_ACCESS_ROLES.includes(role);
}

/**
 * A unica restricao do DESENVOLVEDOR: nao altera nem remove conta ADMIN.
 * Usado para desabilitar os botoes de escrita na tela de Usuarios e a matriz
 * de telas em Permissoes.
 */
export function canManageUser(
  actorRole: Role | undefined,
  target: Pick<User, 'role'>,
): boolean {
  if (actorRole === 'DESENVOLVEDOR' && target.role === 'ADMIN') return false;
  return true;
}

/** Motivo exibido no title/tooltip dos botoes bloqueados pela regra acima. */
export const ADMIN_PROTECTED_HINT =
  'O perfil Desenvolvedor nao pode alterar nem remover contas Administrador.';
