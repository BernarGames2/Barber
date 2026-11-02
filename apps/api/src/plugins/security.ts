import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cabeçalhos de segurança, CORS restrito às origens do painel e proteção CSRF.
 *
 * Defesa CSRF em camadas:
 * 1. Cookie de sessão SameSite=Lax (não acompanha POST de outros sites).
 * 2. Requisições mutáveis com cookie precisam de Origin (ou Sec-Fetch-Site) confiável.
 * 3. Corpos aceitos apenas como application/json (formulários HTML não são interpretados).
 */
export async function securityPlugin(app: FastifyInstance) {
  const { config } = app.deps;

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, config.allowedOrigins.includes(origin.replace(/\/$/, '')));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    maxAge: 600,
  });

  app.addHook('onRequest', async (request) => {
    if (!UNSAFE.has(request.method)) return;
    const hasSession = Boolean(request.cookies?.[config.SESSION_COOKIE_NAME]);
    if (!hasSession) return;
    const origin = request.headers.origin?.replace(/\/$/, '');
    if (origin) {
      if (!config.allowedOrigins.includes(origin)) {
        throw new AppError(403, 'CSRF_REJECTED', 'Origem da requisição não autorizada.');
      }
      return;
    }
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site') throw new AppError(403, 'CSRF_REJECTED', 'Origem da requisição não autorizada.');
  });
}
