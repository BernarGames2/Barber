import { type DbHandle, createDb, loadEnv } from '@barber-voice/db';
import { Redis } from 'ioredis';
import { type App, buildApp } from './app';
import { type Config, loadConfig } from './config';

export interface ApiRuntime {
  config: Config;
  app: App;
  database: DbHandle;
  redis: Redis | null;
  close(): Promise<void>;
}

/**
 * Monta a API com as dependências reais (banco, Redis opcional, provedor de IA pela configuração).
 * Usado pelo servidor HTTP próprio (`server.ts`, contêiner) e pela função da Vercel (`vercel.ts`).
 */
export async function createRuntime(): Promise<ApiRuntime> {
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

  return {
    config,
    app,
    database,
    redis,
    async close() {
      await app.close();
      await database.close();
      redis?.disconnect();
    },
  };
}
