import { createRuntime } from './runtime';

/**
 * Servidor HTTP próprio (desenvolvimento e contêiner). Na Vercel, o ponto de entrada é `vercel.ts`.
 */
const runtime = await createRuntime();
const { app, config } = runtime;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'encerrando com segurança');
  try {
    await runtime.close();
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
