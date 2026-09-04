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

  seed: {
    adminName: process.env.SEED_ADMIN_NAME ?? 'Administrador',
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@sistema.com',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'admin123',
  },
};

export const isProduction = env.nodeEnv === 'production';
