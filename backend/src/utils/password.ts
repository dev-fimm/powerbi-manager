/**
 * ============================================================
 * POLITICA DE SENHA
 * ============================================================
 * Regras aplicadas a TODA senha definida pelo sistema (cadastro de usuario,
 * alteracao pelo admin e troca pelo proprio usuario):
 *
 *  1. Comprimento entre 10 e 72 caracteres.
 *     O limite superior nao e estetico: o bcrypt ignora tudo o que passa de
 *     72 BYTES. Sem esse teto, uma senha longa seria truncada em silencio e o
 *     usuario acharia que tem uma senha mais forte do que realmente tem.
 *  2. Ao menos 3 das 4 classes: minuscula, maiuscula, digito e simbolo.
 *     Exigir as 4 empurra o usuario para o padrao "Senha123!" - previsivel.
 *  3. Nao pode estar na lista de senhas conhecidas (inclui as senhas de seed).
 *  4. Nao pode repetir o mesmo caractere 4+ vezes seguidas ("aaaa").
 *  5. Nao pode conter o nome ou o e-mail do proprio usuario (checagem
 *     contextual, feita nas rotas que conhecem esses dados).
 *
 * As senhas ja existentes no banco continuam validas para login: a politica
 * so incide sobre senhas NOVAS. Nao ha rotacao forcada.
 */

/** Bcrypt ignora bytes alem do 72o; acima disso a senha seria truncada. */
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_POLICY_HINT =
  'A senha deve ter no minimo 10 caracteres e combinar ao menos 3 destes 4 tipos: ' +
  'letra minuscula, letra maiuscula, numero e simbolo.';

/**
 * Senhas triviais bloqueadas. Lista curta e proposital: cobre o obvio
 * (sequencias, teclado, termos do proprio dominio) e as credenciais do seed,
 * que sao publicas neste repositorio.
 */
const COMMON_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '12345678910',
  'qwerty',
  'qwertyui',
  'qwerty123',
  'asdfghjk',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'admin',
  'admin123',
  'administrador',
  'gestor123',
  'viewer123',
  'usuario123',
  'senha',
  'senha123',
  'senha1234',
  'minhasenha',
  'mudar123',
  'trocar123',
  'abc12345',
  'abcd1234',
  'powerbi',
  'powerbi123',
  'iloveyou',
  'brasil123',
  'flamengo',
  'corinthians',
]);

export interface PasswordIssue {
  code:
    | 'too_short'
    | 'too_long'
    | 'not_enough_classes'
    | 'common'
    | 'repeated'
    | 'personal';
  message: string;
}

/**
 * Valida a senha contra a politica. Retorna a lista de problemas encontrados
 * (vazia quando a senha e aceitavel).
 *
 * O parametro `context` e opcional: quando informado, tambem barra senhas que
 * contenham o nome ou o inicio do e-mail do usuario.
 */
export function checkPasswordPolicy(
  password: string,
  context?: { name?: string | null; email?: string | null },
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push({
      code: 'too_short',
      message: `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    });
  }

  // Compara em BYTES: e assim que o bcrypt conta. Acentos ocupam 2 bytes.
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_LENGTH) {
    issues.push({
      code: 'too_long',
      message: `A senha deve ter no maximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    });
  }

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;

  if (classes < 3) {
    issues.push({
      code: 'not_enough_classes',
      message:
        'A senha deve combinar ao menos 3 tipos de caractere: minuscula, maiuscula, numero e simbolo.',
    });
  }

  if (COMMON_PASSWORDS.has(normalize(password))) {
    issues.push({
      code: 'common',
      message: 'Esta senha e muito comum e nao pode ser usada.',
    });
  }

  if (/(.)\1{3,}/.test(password)) {
    issues.push({
      code: 'repeated',
      message: 'A senha nao pode repetir o mesmo caractere 4 vezes seguidas.',
    });
  }

  const personal = personalTokens(context);
  const normalized = normalize(password);
  if (personal.some((token) => normalized.includes(token))) {
    issues.push({
      code: 'personal',
      message: 'A senha nao pode conter o seu nome ou o seu e-mail.',
    });
  }

  return issues;
}

/** true quando a senha atende a politica (sem checagem contextual). */
export function isStrongPassword(password: string): boolean {
  return checkPasswordPolicy(password).length === 0;
}

/** Minusculas e sem acentos, para comparar senha x dados pessoais. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Fragmentos pessoais que a senha nao pode conter: cada parte do nome e o
 * trecho do e-mail antes do "@". Pedacos com menos de 4 caracteres sao
 * ignorados para nao barrar senhas por acaso (ex.: nome "Ana").
 */
function personalTokens(context?: { name?: string | null; email?: string | null }): string[] {
  if (!context) return [];

  const tokens: string[] = [];

  if (context.email) {
    const local = context.email.split('@')[0];
    if (local) tokens.push(local);
  }

  if (context.name) {
    tokens.push(...context.name.split(/\s+/));
  }

  return tokens.map(normalize).filter((t) => t.length >= 4);
}
