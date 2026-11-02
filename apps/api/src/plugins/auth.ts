import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from '../context';
import { Errors } from '../lib/errors';
import type { AuthService } from '../modules/auth/service';

/** Resolve a sessão a partir do cookie em toda requisição (sem exigir login). */
export function authPlugin(app: FastifyInstance, auth: AuthService) {
  app.decorateRequest('auth', null);
  app.decorateRequest('tenantCtx', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies?.[app.deps.config.SESSION_COOKIE_NAME];
    request.auth = token ? await auth.resolveSession(token) : null;
  });
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw Errors.unauthorized();
  return request.auth;
}

export function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string, expiresAt: Date) {
  const { config } = app.deps;
  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(app: FastifyInstance, reply: FastifyReply) {
  const { config } = app.deps;
  reply.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}
