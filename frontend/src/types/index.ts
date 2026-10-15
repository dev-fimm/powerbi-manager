export type Role = 'ADMIN' | 'DESENVOLVEDOR' | 'GESTOR' | 'VISUALIZADOR';
export type ContractStatus = 'ATIVO' | 'SUSPENSO' | 'ENCERRADO';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  /** Telas que a conta pode acessar no menu (efetivas; ADMIN e DESENVOLVEDOR recebem todas). */
  allowed_screens: string[];
  created_at: string;
  updated_at: string;
  contracts?: Contract[];
}

export interface Contract {
  id: string;
  name: string;
  client_name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
  iframes_count?: number;
  users_count?: number;
}

export interface Iframe {
  id: string;
  title: string;
  power_bi_url: string;
  description: string | null;
  contract_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  contract?: Contract;
}

export interface DashboardSummary {
  contracts: { total: number; ativos: number; suspensos: number; encerrados: number };
  iframes: { total: number; ativos: number };
  users: { total: number; ativos: number } | null;
  role: Role;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  description: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

/**
 * Iframe como o VIEWER recebe: sem power_bi_url (o link do Power BI nunca e
 * enviado ao cliente). O painel e carregado via token de embed.
 */
export interface ViewerIframe {
  id: string;
  title: string;
  description: string | null;
  contract_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  embed_token: string;
}

export interface ViewerContractResponse {
  contract: Contract;
  iframes: ViewerIframe[];
}

// ---------------------------------------------------------- monitoramento
/**
 * Resposta de GET /api/monitoring/overview. A tela carrega tudo de uma vez
 * porque varias metricas saem do mesmo conjunto de linhas de auditoria.
 */
export interface MonitoringOverview {
  range: { from: string; to: string; granularity: 'day' | 'week' };
  /** Conta a que as metricas estao restritas, ou null para todas. */
  user_id: string | null;
  /** true = o periodo bateu no teto de linhas lidas; os numeros estao incompletos. */
  truncated: boolean;
  inactive_days: number;
  summary: {
    /** Sessoes de uso medidas por heartbeat. */
    sessions: number;
    logins: number;
    active_users: number;
    iframe_views: number;
    login_failures: number;
    total_seconds: number;
    avg_session_seconds: number;
    /** Contas com sinal recente - quem esta no sistema agora. */
    online_now: number;
  };
  timeline: { period: string; sessions: number; iframe_views: number }[];
  top_iframes: {
    iframe_id: string;
    title: string;
    contract_name: string | null;
    client_name: string | null;
    is_active: boolean | null;
    views: number;
    viewers: number;
  }[];
  never_accessed: {
    iframe_id: string;
    title: string;
    contract_name: string;
    client_name: string;
  }[];
  by_user: {
    user_id: string;
    name: string;
    email: string | null;
    role: Role | null;
    sessions: number;
    seconds: number;
    iframe_views: number;
    last_access: string | null;
    online: boolean;
  }[];
  last_accesses: {
    user_id: string;
    name: string;
    email: string | null;
    started_at: string;
    last_seen_at: string;
    duration_seconds: number;
    /** true = sinal recente; a sessao ainda esta acontecendo. */
    online: boolean;
    ip_address: string | null;
  }[];
  by_contract: {
    contract_id: string;
    name: string;
    client_name: string | null;
    iframe_views: number;
    seconds: number;
    visitors: number;
  }[];
  /** Matriz [dia da semana 0..6][hora 0..23] com a contagem de eventos. */
  heatmap: number[][];
  login_failures: { identifier: string | null; attempts: number }[];
  inactive_users: {
    user_id: string;
    name: string;
    email: string;
    role: Role;
    last_login: string | null;
  }[];
}
