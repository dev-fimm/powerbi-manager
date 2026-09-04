import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { scheduleAuditRetention } from './utils/auditRetention';

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] rodando em http://localhost:${env.port}/api (${env.nodeEnv})`);
});

// Expurgo dos logs de auditoria vencidos (roda agora e a cada 24h).
const stopAuditRetention = scheduleAuditRetention();

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n[api] recebido ${signal}, encerrando...`);
  stopAuditRetention();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
