/**
 * ============================================================
 * CATALOGO DE TELAS (frontend)
 * ============================================================
 * Espelha o catalogo do backend (backend/src/utils/screens.ts).
 * Controla o menu e o bloqueio de rotas por conta.
 */

export interface ScreenDef {
  key: string;
  label: string;
  path: string;
}

/** Telas configuraveis por conta (aparecem na matriz de Permissoes). */
export const MANAGEABLE_SCREENS: ScreenDef[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'contracts', label: 'Contratos', path: '/contracts' },
  { key: 'iframes', label: 'Iframes', path: '/iframes' },
  { key: 'viewer', label: 'Paineis', path: '/paineis' },
];

/** Telas de gestao: so ADMIN e DESENVOLVEDOR (nunca liberadas para as demais). */
export const ADMIN_SCREENS: ScreenDef[] = [
  { key: 'users', label: 'Usuarios', path: '/users' },
  { key: 'permissions', label: 'Permissoes', path: '/permissions' },
  { key: 'logs', label: 'Logs', path: '/logs' },
];

/** Todas as telas, na ordem de exibicao do menu. */
export const ALL_SCREENS: ScreenDef[] = [
  MANAGEABLE_SCREENS[0], // Dashboard
  ...ADMIN_SCREENS.slice(0, 2), // Usuarios, Permissoes
  ...MANAGEABLE_SCREENS.slice(1), // Contratos, Iframes, Viewer
  ADMIN_SCREENS[2], // Logs
];

/**
 * Primeira tela que a conta pode acessar (destino de fallback quando o
 * usuario tenta abrir uma tela sem permissao ou logo apos o login).
 */
export function firstAllowedPath(allowed: string[] | undefined): string {
  const found = ALL_SCREENS.find((s) => allowed?.includes(s.key));
  return found?.path ?? '/login';
}
