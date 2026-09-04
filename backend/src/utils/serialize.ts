import type { AuditLog, Contract, ContractStatus, Iframe, Role, User } from '@prisma/client';
import { effectiveScreens } from './screens';

/**
 * O Prisma usa camelCase internamente; a API publica usa snake_case
 * (conforme a especificacao). Estas funcoes fazem a traducao e, no caso
 * do usuario, garantem que password_hash NUNCA saia na resposta.
 *
 * Os tipos de retorno sao explicitos porque contrato e iframe se referenciam
 * mutuamente (o TypeScript nao consegue inferir tipos circulares).
 */

export interface ContractDTO {
  id: string;
  name: string;
  client_name: string;
  description: string | null;
  start_date: Date;
  end_date: Date;
  status: ContractStatus;
  created_at: Date;
  updated_at: Date;
  iframes_count?: number;
  users_count?: number;
  iframes?: IframeDTO[];
}

export interface IframeDTO {
  id: string;
  title: string;
  power_bi_url: string;
  description: string | null;
  contract_id: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  contract?: ContractDTO;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  /** Telas efetivas (o menu que o front deve exibir para esta conta). */
  allowed_screens: string[];
  created_at: Date;
  updated_at: Date;
  contracts?: ContractDTO[];
}

type ContractWithExtras = Contract & {
  iframes?: Iframe[];
  _count?: { iframes?: number; users?: number };
};

type IframeWithContract = Iframe & { contract?: Contract | null };

type UserWithContracts = User & {
  contracts?: { contract: Contract }[];
};

export function serializeContract(contract: ContractWithExtras): ContractDTO {
  return {
    id: contract.id,
    name: contract.name,
    client_name: contract.clientName,
    description: contract.description,
    start_date: contract.startDate,
    end_date: contract.endDate,
    status: contract.status,
    created_at: contract.createdAt,
    updated_at: contract.updatedAt,
    // Cada contador so aparece quando a rota realmente o selecionou. Isso
    // permite que rotas de perfis nao-ADMIN omitam users_count (quantas contas
    // acessam o contrato e informacao de gestao, nao de consumo) sem que o
    // serializer devolva um "0" enganoso no lugar.
    ...(contract._count
      ? {
          ...(contract._count.iframes !== undefined
            ? { iframes_count: contract._count.iframes }
            : {}),
          ...(contract._count.users !== undefined
            ? { users_count: contract._count.users }
            : {}),
        }
      : {}),
    ...(contract.iframes ? { iframes: contract.iframes.map(serializeIframe) } : {}),
  };
}

export interface ViewerIframeDTO {
  id: string;
  title: string;
  description: string | null;
  contract_id: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  /** Token curto para carregar o painel via /viewer/iframes/:id/embed. */
  embed_token: string;
}

/**
 * Serializacao do iframe para o VIEWER: NUNCA inclui power_bi_url (regra de
 * seguranca - o link do Power BI nao pode ser exposto). No lugar, envia um
 * token de embed que o front usa como src do iframe.
 */
export function serializeViewerIframe(iframe: Iframe, embedToken: string): ViewerIframeDTO {
  return {
    id: iframe.id,
    title: iframe.title,
    description: iframe.description,
    contract_id: iframe.contractId,
    is_active: iframe.isActive,
    created_at: iframe.createdAt,
    updated_at: iframe.updatedAt,
    embed_token: embedToken,
  };
}

export function serializeIframe(iframe: IframeWithContract): IframeDTO {
  return {
    id: iframe.id,
    title: iframe.title,
    power_bi_url: iframe.powerBiUrl,
    description: iframe.description,
    contract_id: iframe.contractId,
    is_active: iframe.isActive,
    created_at: iframe.createdAt,
    updated_at: iframe.updatedAt,
    ...(iframe.contract ? { contract: serializeContract(iframe.contract) } : {}),
  };
}

export interface AuditLogDTO {
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
  created_at: Date;
}

export function serializeAuditLog(log: AuditLog): AuditLogDTO {
  return {
    id: log.id,
    user_id: log.userId,
    user_name: log.userName,
    user_email: log.userEmail,
    action: log.action,
    entity: log.entity,
    entity_id: log.entityId,
    description: log.description,
    ip_address: log.ipAddress,
    user_agent: log.userAgent,
    created_at: log.createdAt,
  };
}

export function serializeUser(user: UserWithContracts): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    is_active: user.isActive,
    allowed_screens: effectiveScreens(user),
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    // password_hash omitido de proposito.
    ...(user.contracts
      ? { contracts: user.contracts.map((c) => serializeContract(c.contract)) }
      : {}),
  };
}
