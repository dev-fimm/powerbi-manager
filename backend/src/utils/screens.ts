import { Role } from '@prisma/client';

/**
 * ============================================================
 * CATALOGO DE TELAS
 * ============================================================
 * Controle de acesso por CONTA (nao por perfil) as telas do frontend.
 * O ADMIN sempre acessa todas as telas e nao pode ser restringido.
 *
 * IMPORTANTE: isto controla a NAVEGACAO (menu + rotas do front). A
 * autorizacao dos DADOS continua no backend, validada por perfil em
 * cada rota. Ou seja, liberar a tela "users" para um GESTOR mostra o
 * menu, mas a API /users continua exigindo ADMIN.
 */

/** Telas cujo acesso e configuravel por conta na tela de Permissoes. */
export const MANAGEABLE_SCREENS = ['dashboard', 'contracts', 'iframes', 'viewer'] as const;

/** Telas exclusivas de ADMIN: sempre visiveis para ADMIN, nunca para os demais. */
export const ADMIN_SCREENS = ['users', 'permissions', 'logs'] as const;

export const ALL_SCREENS: string[] = [...MANAGEABLE_SCREENS, ...ADMIN_SCREENS];

const MANAGEABLE_SET = new Set<string>(MANAGEABLE_SCREENS);

/** Telas efetivas de um usuario: o que o menu do front vai exibir. */
export function effectiveScreens(user: { role: Role; allowedScreens: string[] }): string[] {
  if (user.role === Role.ADMIN) return [...ALL_SCREENS];
  // Defensivo: mantem apenas telas configuraveis validas.
  return user.allowedScreens.filter((s) => MANAGEABLE_SET.has(s));
}

/** Telas padrao ao criar uma conta, conforme o perfil. */
export function defaultScreensForRole(role: Role): string[] {
  if (role === Role.ADMIN) return [...ALL_SCREENS];
  // GESTOR e VISUALIZADOR recebem por padrao todas as telas configuraveis
  // (mesmo menu que tinham antes deste controle existir).
  return [...MANAGEABLE_SCREENS];
}

/** Filtra uma lista arbitraria mantendo apenas telas configuraveis validas. */
export function sanitizeManageableScreens(screens: string[]): string[] {
  return Array.from(new Set(screens)).filter((s) => MANAGEABLE_SET.has(s));
}
