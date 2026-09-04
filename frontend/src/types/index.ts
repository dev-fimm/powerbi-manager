export type Role = 'ADMIN' | 'GESTOR' | 'VISUALIZADOR';
export type ContractStatus = 'ATIVO' | 'SUSPENSO' | 'ENCERRADO';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  /** Telas que a conta pode acessar no menu (efetivas; ADMIN recebe todas). */
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
