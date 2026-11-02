import { createDb, loadEnv } from '@barber-voice/db';
import { Redis } from 'ioredis';
import { buildApp } from './app';
import { loadConfig } from './config';

loadEnv();
const config = loadConfig();

const database = createDb(config.DATABASE_URL, {
  max: config.DB_POOL_MAX,
  applicationName: 'barber-voice-api',
});
const redis = config.REDIS_URL
  ? new Redis(config.REDIS_URL, {
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
  : null;
redis?.on('error', () => undefined); // o rate limit falha aberto; erros já são registrados pelo plugin

const app = await buildApp(
  { config, db: database.db, clock: () => new Date() },
  { redis: redis ?? undefined },
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'encerrando com segurança');
  try {
    await app.close();
    await database.close();
    redis?.disconnect();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandledRejection'));

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.fatal({ err }, 'falha ao iniciar a API');
  process.exit(1);
}
