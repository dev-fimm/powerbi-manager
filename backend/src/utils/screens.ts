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

/** Tela de Paineis: unica liberada por padrao em contas GESTOR/VISUALIZADOR. */
export const VIEWER_SCREEN = 'viewer';

export const ALL_SCREENS: string[] = [...MANAGEABLE_SCREENS, ...ADMIN_SCREENS];

const MANAGEABLE_SET = new Set<string>(MANAGEABLE_SCREENS);

/** Telas efetivas de um usuario: o que o menu do front vai exibir. */
export function effectiveScreens(user: { role: Role; allowedScreens: string[] }): string[] {
  if (user.role === Role.ADMIN) return [...ALL_SCREENS];
  // Defensivo: mantem apenas telas configuraveis validas.
  return user.allowedScreens.filter((s) => MANAGEABLE_SET.has(s));
}

/**
 * Telas padrao ao criar uma conta, conforme o perfil.
 *
 * GESTOR e VISUALIZADOR nascem com acesso APENAS a tela de Paineis ("viewer").
 * Dashboard, Contratos e Iframes sao liberados depois, conta a conta, na tela
 * de Permissoes.
 *
 * A logica e de privilegio minimo: a conta comeca com o que precisa para
 * cumprir a finalidade dela (ver os paineis) e cresce por decisao explicita de
 * um ADMIN. Antes, toda conta nova ja vinha com as quatro telas configuraveis,
 * o que significava que ninguem nunca REMOVIA acesso - so esquecia de remover.
 *
 * Contas ja existentes nao sao afetadas: isto vale no momento da criacao.
 */
export function defaultScreensForRole(role: Role): string[] {
  if (role === Role.ADMIN) return [...ALL_SCREENS];
  return [VIEWER_SCREEN];
}

/** Filtra uma lista arbitraria mantendo apenas telas configuraveis validas. */
export function sanitizeManageableScreens(screens: string[]): string[] {
  return Array.from(new Set(screens)).filter((s) => MANAGEABLE_SET.has(s));
}
