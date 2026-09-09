import type { ContractStatus, Role } from '../types';

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  // Usa UTC porque as datas de contrato sao do tipo DATE (sem fuso).
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

/** Data + hora no fuso local (usado nos logs de auditoria, que sao timestamps reais). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/** Converte ISO para o formato aceito por <input type="date"> (yyyy-mm-dd). */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  DESENVOLVEDOR: 'Desenvolvedor',
  GESTOR: 'Gestor',
  VISUALIZADOR: 'Visualizador',
};

export const STATUS_LABEL: Record<ContractStatus, string> = {
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  ENCERRADO: 'Encerrado',
};

/** Rotulos amigaveis das acoes de auditoria (chave = action do backend). */
export const LOG_ACTION_LABEL: Record<string, string> = {
  LOGIN: 'Login',
  LOGIN_FAILED: 'Falha de login',
  LOGOUT: 'Logout',
  PAGE_VIEW: 'Tela acessada',
  PASSWORD_CHANGE: 'Senha alterada',
  PASSWORD_RESET: 'Senha redefinida pelo admin',
  AUDIT_PURGE: 'Expurgo de logs',
  USER_CREATE: 'Usuario criado',
  USER_UPDATE: 'Usuario atualizado',
  USER_DELETE: 'Usuario excluido',
  USER_CONTRACTS: 'Contratos do usuario',
  USER_SCREENS: 'Telas do usuario',
  USER_IFRAMES: 'Dashboards do usuario',
  CONTRACT_CREATE: 'Contrato criado',
  CONTRACT_UPDATE: 'Contrato atualizado',
  CONTRACT_DELETE: 'Contrato excluido',
  IFRAME_CREATE: 'Iframe criado',
  IFRAME_UPDATE: 'Iframe atualizado',
  IFRAME_DELETE: 'Iframe excluido',
};

/** Cor do badge por natureza da acao. */
export type LogTone = 'emerald' | 'rose' | 'brand' | 'amber' | 'slate';

export const LOG_ACTION_TONE: Record<string, LogTone> = {
  LOGIN: 'emerald',
  LOGOUT: 'slate',
  LOGIN_FAILED: 'rose',
  PAGE_VIEW: 'slate',
  PASSWORD_CHANGE: 'amber',
  PASSWORD_RESET: 'rose',
  AUDIT_PURGE: 'slate',
  USER_CREATE: 'brand',
  USER_UPDATE: 'amber',
  USER_DELETE: 'rose',
  USER_CONTRACTS: 'amber',
  USER_SCREENS: 'amber',
  USER_IFRAMES: 'amber',
  CONTRACT_CREATE: 'brand',
  CONTRACT_UPDATE: 'amber',
  CONTRACT_DELETE: 'rose',
  IFRAME_CREATE: 'brand',
  IFRAME_UPDATE: 'amber',
  IFRAME_DELETE: 'rose',
};

/** Nome amigavel de cada tela, usado no registro de navegacao (page view). */
export const SCREEN_LABEL: Record<string, string> = {
  '/': 'Dashboard',
  '/users': 'Usuarios',
  '/logs': 'Logs de auditoria',
  '/contracts': 'Contratos',
  '/iframes': 'Iframes',
  '/paineis': 'Paineis',
};

/** Resolve o nome da tela a partir do pathname (trata rotas dinamicas). */
export function screenLabelFromPath(path: string): string {
  if (SCREEN_LABEL[path]) return SCREEN_LABEL[path];
  if (path.startsWith('/paineis/')) return 'Paineis (contrato)';
  return path;
}
