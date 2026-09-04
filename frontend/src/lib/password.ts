/**
 * ============================================================
 * POLITICA DE SENHA (frontend)
 * ============================================================
 * Espelha backend/src/utils/password.ts.
 *
 * O backend continua sendo a fonte da verdade - isto existe para o usuario
 * saber o que falta na senha ENQUANTO digita, em vez de descobrir depois de
 * enviar o formulario. As duas listas precisam ser atualizadas juntas.
 */

export const PASSWORD_MIN_LENGTH = 10;
/** Bcrypt ignora o que passa de 72 bytes; acima disso a senha seria truncada. */
export const PASSWORD_MAX_BYTES = 72;

/** Senhas triviais bloqueadas (mesma lista do backend). */
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

/**
 * ============================================================
 * GERADOR DE SENHA
 * ============================================================
 * Alternativa a digitacao manual - as duas formas continuam valendo.
 *
 * Os conjuntos abaixo omitem caracteres ambiguos (0/O, 1/l/I) de proposito:
 * a senha gerada quase sempre e transcrita ou ditada para outra pessoa, e
 * confundir "l" com "1" vira um chamado de "nao consigo entrar".
 */
const GEN_LOWER = 'abcdefghijkmnopqrstuvwxyz'; // sem "l"
const GEN_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem "I" e "O"
const GEN_DIGITS = '23456789'; // sem "0" e "1"
const GEN_SYMBOLS = '!@#$%*-_=+?';

const GENERATED_LENGTH = 16;

/**
 * Inteiro aleatorio em [0, max) a partir do CSPRNG do navegador.
 *
 * Usa amostragem por rejeicao em vez de um simples `% max`: como 2^32 nao e
 * divisivel por max, o resto puro tornaria os primeiros valores levemente mais
 * provaveis. Math.random() nao serve aqui - nao e criptograficamente seguro.
 */
function randomInt(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return value % max;
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!;
}

/**
 * Gera uma senha que atende a politica.
 *
 * Garante um caractere de cada um dos 4 tipos (a politica exige 3) e embaralha
 * o resultado, para que as posicoes fixas nao virem um padrao previsivel.
 * Ao final valida contra a propria politica e tenta de novo se algo escapar -
 * na pratica o laco nao repete, mas evita que o botao entregue uma senha que o
 * backend recusaria.
 */
export function generatePassword(context?: { name?: string; email?: string }): string {
  const all = GEN_LOWER + GEN_UPPER + GEN_DIGITS + GEN_SYMBOLS;

  for (let attempt = 0; attempt < 20; attempt++) {
    const chars = [pick(GEN_LOWER), pick(GEN_UPPER), pick(GEN_DIGITS), pick(GEN_SYMBOLS)];

    while (chars.length < GENERATED_LENGTH) chars.push(pick(all));

    // Fisher-Yates com a mesma fonte segura de aleatoriedade.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }

    const password = chars.join('');
    if (checkPassword(password, context).valid) return password;
  }

  // Inalcancavel na pratica; existe para a funcao nunca devolver algo invalido.
  throw new Error('Nao foi possivel gerar uma senha valida. Tente novamente.');
}

export interface PasswordRule {
  label: string;
  ok: boolean;
}

export interface PasswordCheck {
  rules: PasswordRule[];
  /** true quando todas as regras passam. */
  valid: boolean;
  /** 0 a 4 - usado apenas na barra de forca. */
  score: number;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Fragmentos do nome/e-mail que a senha nao pode conter (>= 4 caracteres). */
function personalTokens(context?: { name?: string; email?: string }): string[] {
  if (!context) return [];
  const tokens: string[] = [];
  if (context.email) {
    const local = context.email.split('@')[0];
    if (local) tokens.push(local);
  }
  if (context.name) tokens.push(...context.name.split(/\s+/));
  return tokens.map(normalize).filter((t) => t.length >= 4);
}

/**
 * Avalia a senha e devolve a lista de regras com o status de cada uma, para
 * a interface mostrar o que ja foi atendido e o que falta.
 */
export function checkPassword(
  password: string,
  context?: { name?: string; email?: string },
): PasswordCheck {
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;

  const normalized = normalize(password);
  const tokens = personalTokens(context);

  const rules: PasswordRule[] = [
    {
      label: `Ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
      ok: password.length >= PASSWORD_MIN_LENGTH && byteLength(password) <= PASSWORD_MAX_BYTES,
    },
    {
      label: 'Combina 3 tipos: minuscula, maiuscula, numero, simbolo',
      ok: classes >= 3,
    },
    {
      label: 'Nao e uma senha comum',
      ok: password.length > 0 && !COMMON_PASSWORDS.has(normalized),
    },
    {
      label: 'Sem 4 caracteres iguais seguidos',
      ok: password.length > 0 && !/(.)\1{3,}/.test(password),
    },
  ];

  if (tokens.length > 0) {
    rules.push({
      label: 'Nao contem o seu nome nem o seu e-mail',
      ok: password.length > 0 && !tokens.some((t) => normalized.includes(t)),
    });
  }

  return {
    rules,
    valid: password.length > 0 && rules.every((r) => r.ok),
    score: rules.filter((r) => r.ok).length,
  };
}
