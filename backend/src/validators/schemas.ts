import { ContractStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { checkPasswordPolicy } from '../utils/password';
import { POWER_BI_URL_ERROR, isValidPowerBiUrl } from '../utils/powerbi';

export const uuidParam = z.object({
  id: z.string().uuid('Identificador invalido.'),
});

/**
 * Campo de senha sujeito a politica (utils/password.ts). Cada regra violada
 * vira um issue separado, entao o 422 devolvido ao front lista exatamente o
 * que falta na senha em vez de um "senha invalida" generico.
 */
const strongPasswordField = z.string().superRefine((value, ctx) => {
  for (const issue of checkPasswordPolicy(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message });
  }
});

/**
 * Reaplica a politica considerando nome e e-mail do proprio usuario, de modo
 * que "joao.silva" nao possa virar a senha de joao.silva@empresa.com.
 * Usado nos schemas que ja trazem esses campos no mesmo payload.
 */
function refinePasswordAgainstIdentity<
  T extends { password?: string; name?: string; email?: string },
>(data: T, ctx: z.RefinementCtx): void {
  if (!data.password) return;
  const contextual = checkPasswordPolicy(data.password, {
    name: data.name,
    email: data.email,
  }).filter((i) => i.code === 'personal');

  for (const issue of contextual) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: ['password'] });
  }
}

/** Campo reutilizavel com a validacao da URL publica do Power BI (regra 4). */
const powerBiUrlField = z
  .string()
  .trim()
  .min(1, 'A URL do Power BI e obrigatoria.')
  .refine(isValidPowerBiUrl, POWER_BI_URL_ERROR);

/** Aceita "2026-01-31" ou ISO completo e converte para Date. */
const dateField = z
  .union([z.string(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Data invalida.' });
      return z.NEVER;
    }
    return date;
  });

// ---------------------------------------------------------------- auth
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail invalido.'),
  password: z.string().min(1, 'A senha e obrigatoria.'),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto.'),
    email: z.string().trim().toLowerCase().email('E-mail invalido.'),
    password: strongPasswordField,
    role: z.nativeEnum(Role).optional(),
  })
  .superRefine(refinePasswordAgainstIdentity);

/**
 * Troca de senha pelo proprio usuario (POST /api/auth/change-password).
 * Exige a senha atual: sem isso, uma sessao sequestrada trocaria a senha e
 * expulsaria o dono da conta.
 */
export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Informe a sua senha atual.'),
  new_password: strongPasswordField,
});

// ---------------------------------------------------------------- users
export const createUserSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto.'),
    email: z.string().trim().toLowerCase().email('E-mail invalido.'),
    password: strongPasswordField,
    role: z.nativeEnum(Role).default(Role.VISUALIZADOR),
    isActive: z.boolean().default(true),
    contractIds: z.array(z.string().uuid()).optional(),
  })
  .superRefine(refinePasswordAgainstIdentity);

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    email: z.string().trim().toLowerCase().email('E-mail invalido.').optional(),
    // Senha opcional: so e re-hasheada quando enviada e nao vazia.
    password: strongPasswordField.optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
    // Senha de quem esta executando a acao. Exigida apenas para redefinir a
    // senha de uma conta ADMIN (reautenticacao - ver users.routes.ts).
    current_password: z.string().min(1).optional(),
  })
  .superRefine(refinePasswordAgainstIdentity);

export const setUserContractsSchema = z.object({
  contract_ids: z.array(z.string().uuid('Identificador de contrato invalido.')),
});

export const setUserScreensSchema = z.object({
  screens: z.array(z.string().trim().min(1)).max(20),
});

export const setUserIframesSchema = z.object({
  iframe_ids: z.array(z.string().uuid('Identificador de painel invalido.')),
});

// ---------------------------------------------------------------- contracts
export const createContractSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome do contrato e obrigatorio.'),
    client_name: z.string().trim().min(2, 'Nome do cliente e obrigatorio.'),
    description: z.string().trim().optional().nullable(),
    start_date: dateField,
    end_date: dateField,
    status: z.nativeEnum(ContractStatus).default(ContractStatus.ATIVO),
  })
  .refine((data) => data.end_date >= data.start_date, {
    message: 'A data de termino deve ser posterior a data de inicio.',
    path: ['end_date'],
  });

export const updateContractSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    client_name: z.string().trim().min(2).optional(),
    description: z.string().trim().optional().nullable(),
    start_date: dateField.optional(),
    end_date: dateField.optional(),
    status: z.nativeEnum(ContractStatus).optional(),
  })
  .refine(
    (data) =>
      !data.start_date || !data.end_date || data.end_date >= data.start_date,
    { message: 'A data de termino deve ser posterior a data de inicio.', path: ['end_date'] },
  );

export const listContractsQuerySchema = z.object({
  status: z.nativeEnum(ContractStatus).optional(),
  search: z.string().trim().optional(),
});

// ---------------------------------------------------------------- iframes
export const createIframeSchema = z.object({
  title: z.string().trim().min(2, 'O titulo e obrigatorio.'),
  power_bi_url: powerBiUrlField,
  description: z.string().trim().optional().nullable(),
  // Regra 3: iframe SEMPRE pertence a um contrato.
  contract_id: z.string().uuid('Selecione um contrato valido.'),
  is_active: z.boolean().default(true),
});

export const updateIframeSchema = z.object({
  title: z.string().trim().min(2).optional(),
  power_bi_url: powerBiUrlField.optional(),
  description: z.string().trim().optional().nullable(),
  contract_id: z.string().uuid().optional(),
  is_active: z.boolean().optional(),
});

// ---------------------------------------------------------------- logs
/** Corpo enviado pelo front a cada navegacao de tela (page view). */
export const pageViewSchema = z.object({
  path: z.string().trim().min(1, 'Rota obrigatoria.').max(300),
  label: z.string().trim().max(120).optional(),
});

export const listLogsQuerySchema = z.object({
  action: z.string().trim().min(1).optional(),
  user_id: z.string().uuid('Identificador de usuario invalido.').optional(),
  search: z.string().trim().optional(),
  // Datas no formato yyyy-mm-dd (vindas de <input type="date">).
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const listIframesQuerySchema = z.object({
  contract_id: z.string().uuid().optional(),
  is_active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  search: z.string().trim().optional(),
});
