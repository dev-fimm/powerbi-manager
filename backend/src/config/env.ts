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

  seed: {
    adminName: process.env.SEED_ADMIN_NAME ?? 'Administrador',
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@sistema.com',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'admin123',
  },
};

export const isProduction = env.nodeEnv === 'production';
