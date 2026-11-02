import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { AppDeps } from './context';
import { errorHandler } from './lib/errors';
import { ConsoleMailer, type Mailer } from './lib/mailer';
import { type LlmClient, createLlmClient } from './modules/receptionist/llm';
import { appointmentRoutes } from './modules/appointments/routes';
import { authRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { catalogRoutes } from './modules/catalog/routes';
import { customerRoutes } from './modules/customers/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { systemRoutes } from './modules/system/routes';
import { tenantCreationRoutes, tenantRoutes } from './modules/tenants/routes';
import { receptionistRoutes } from './modules/receptionist/routes';
import { voiceStudioRoutes } from './modules/voice-studio/routes';
import { authPlugin } from './plugins/auth';
import { securityPlugin } from './plugins/security';
import { resolveTenant } from './plugins/tenant';
import './context';

export interface BuildOptions {
  logger?: FastifyServerOptions['logger'];
  /** Instância ioredis para rate limiting distribuído (opcional). */
  redis?: unknown;
}

/** "true"/"false" ou lista de IPs/CIDRs/presets do proxy-addr (ex.: "loopback, 10.0.0.0/8"). */
function parseTrustProxy(value: string): boolean | string[] {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Remove o prefixo público (ex.: "/api") do caminho, preservando a query string. */
export function stripPathPrefix(url: string, prefix: string): string {
  if (!prefix || prefix === '/') return url;
  if (url === prefix || url.startsWith(`${prefix}?`)) return `/${url.slice(prefix.length)}`;
  if (url.startsWith(`${prefix}/`)) return url.slice(prefix.length);
  return url;
}

export async function buildApp(
  deps: Omit<AppDeps, 'mailer' | 'llm'> & { mailer?: Mailer; llm?: LlmClient | null },
  options: BuildOptions = {},
) {
  const app = Fastify({
    logger: options.logger ?? {
      level: deps.config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
        ],
        censor: '[REDACTED]',
      },
    },
    trustProxy: parseTrustProxy(deps.config.TRUST_PROXY),
    // Rotas públicas ficam sob /api (Vercel e proxy do painel); a API também responde sem o prefixo
    // (health checks de contêiner e chamadas diretas).
    rewriteUrl: (req) => stripPathPrefix(req.url ?? '/', deps.config.API_PATH_PREFIX),
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    routerOptions: { ignoreTrailingSlash: true },
  });

  const fullDeps: AppDeps = {
    ...deps,
    mailer: deps.mailer ?? new ConsoleMailer(app.log, deps.config.NODE_ENV === 'production'),
    llm: deps.llm === undefined ? createLlmClient(deps.config) : deps.llm,
  };
  app.decorate('deps', fullDeps);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }),
  );
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // respostas de API com dados pessoais não devem ficar em cache intermediário
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  await app.register(cookie);
  await securityPlugin(app);
  await app.register(rateLimit, {
    global: true,
    max: fullDeps.config.RATE_LIMIT_GLOBAL_PER_MIN,
    timeWindow: '1 minute',
    ...(options.redis ? { redis: options.redis, nameSpace: 'bv-rl:', skipOnError: true } : {}),
  });

  const auth = createAuthService(fullDeps);
  authPlugin(app, auth);

  systemRoutes(app);
  authRoutes(app, auth);
  tenantCreationRoutes(app);

  await app.register(
    async (scoped) => {
      scoped.addHook('preHandler', resolveTenant);
      tenantRoutes(scoped);
      catalogRoutes(scoped);
      customerRoutes(scoped);
      appointmentRoutes(scoped);
      dashboardRoutes(scoped);
      voiceStudioRoutes(scoped);
      receptionistRoutes(scoped);
    },
    { prefix: '/v1/tenants/:tenantId' },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
