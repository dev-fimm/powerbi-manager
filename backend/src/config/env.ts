import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${name}. Veja o arquivo .env.example.`,
    );
  }
  return value;
}

/** Le um inteiro >= 1 (valor zero nao faz sentido para limite ou janela). */
function atLeastOne(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `Variavel de ambiente invalida: esperado um inteiro >= 1, recebido "${raw}".`,
    );
  }
  return parsed;
}

/**
 * Le a sequencia de duracoes de bloqueio ("60,300,900,3600,86400").
 *
 * Cada posicao e a duracao, em segundos, do bloqueio daquele nivel; o ultimo
 * degrau vale para todos os bloqueios seguintes. Uma sequencia vazia ou com
 * valor invalido derruba o boot de proposito: silenciosamente cair no padrao
 * mascararia um typo que enfraquece a protecao.
 */
function blockSteps(raw: string | undefined, fallback: number[]): number[] {
  if (raw === undefined || raw.trim() === '') return fallback;

  const steps = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const parsed = Number(part);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
          `LOGIN_THROTTLE_BLOCK_STEPS invalido: "${part}" nao e um inteiro >= 1.`,
        );
      }
      return parsed;
    });

  if (steps.length === 0) {
    throw new Error('LOGIN_THROTTLE_BLOCK_STEPS nao pode ser uma lista vazia.');
  }
  return steps;
}

/**
 * Le um inteiro >= 0 da variavel de ambiente. Valor ausente, nao numerico ou
 * negativo cai no padrao - assim um typo no .env nao vira NaN silencioso.
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Variavel de ambiente invalida: esperado um inteiro >= 0, recebido "${raw}".`,
    );
  }
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3333),

  databaseUrl: required('DATABASE_URL'),

  // ATENCAO: em producao o JWT_SECRET precisa ser definido de verdade.
  // O fallback abaixo so existe para nao quebrar o ambiente de desenvolvimento.
  jwtSecret: required('JWT_SECRET', 'dev-secret-troque-em-producao'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),

  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  /**
   * Retencao dos logs de auditoria, em dias. Registros mais antigos que isso
   * sao apagados por um job diario (utils/auditRetention.ts).
   *
   * Os logs guardam IP e user-agent, que sao dados pessoais: mante-los para
   * sempre sem necessidade e exposicao desnecessaria e conflita com o
   * principio da LGPD de nao reter alem da finalidade. Use 0 para desligar
   * o expurgo (por exemplo, quando ha uma exigencia contratual de guarda).
   */
  auditLogRetentionDays: positiveInt(process.env.AUDIT_LOG_RETENTION_DAYS, 365),

  /**
   * ============================================================
   * PROTECAO CONTRA FORCA BRUTA NO LOGIN
   * ============================================================
   * Errar a senha N vezes dentro de uma janela bloqueia novas tentativas por
   * um tempo. O controle e feito em dois eixos (ver utils/loginThrottle.ts):
   *
   * - CONTA: impede martelar a senha de um usuario especifico.
   * - IP: impede varrer muitas contas a partir da mesma origem.
   *
   * O limite por IP e separado, e maior, de proposito. Varias pessoas saem
   * pelo mesmo IP num escritorio (NAT); usar o limite da conta tambem para o
   * IP faria tres erros de senha de tres pessoas diferentes derrubarem o
   * login do predio inteiro - uma negacao de servico auto-infligida.
   */
  loginThrottle: {
    maxAttempts: atLeastOne(process.env.LOGIN_THROTTLE_MAX_ATTEMPTS, 3),
    windowSeconds: atLeastOne(process.env.LOGIN_THROTTLE_WINDOW_SECONDS, 60),
    maxAttemptsPerIp: atLeastOne(
      process.env.LOGIN_THROTTLE_IP_MAX_ATTEMPTS,
      atLeastOne(process.env.LOGIN_THROTTLE_MAX_ATTEMPTS, 3) * 5,
    ),

    /**
     * Backoff exponencial: 1min, 5min, 15min, 1h e 24h do 5o bloqueio em
     * diante. Reincidir fica progressivamente mais caro, enquanto o engano
     * honesto de senha custa apenas um minuto.
     */
    blockSteps: blockSteps(process.env.LOGIN_THROTTLE_BLOCK_STEPS, [
      60,
      5 * 60,
      15 * 60,
      60 * 60,
      24 * 60 * 60,
    ]),

    /**
     * Tempo sem NENHUMA tentativa falha para o nivel voltar a zero. O nivel
     * sobrevive ao fim do bloqueio de proposito: se zerasse junto, bastaria
     * esperar o bloqueio passar para levar sempre a punicao minima.
     */
    levelResetSeconds: atLeastOne(
      process.env.LOGIN_THROTTLE_LEVEL_RESET_SECONDS,
      24 * 60 * 60,
    ),

    /**
     * true: o ultimo degrau deixa de ter prazo e passa a exigir liberacao
     * manual - na pratica, a redefinicao da senha pelo administrador, que
     * limpa o contador.
     */
    manualUnlockAtLastStep: process.env.LOGIN_THROTTLE_MANUAL_UNLOCK === 'true',
  },

  seed: {
    adminName: process.env.SEED_ADMIN_NAME ?? 'Administrador',
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@sistema.com',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'admin123',
  },
};

export const isProduction = env.nodeEnv === 'production';
