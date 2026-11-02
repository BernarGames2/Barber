import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { requestMeta } from '../../lib/permissions';
import { parse, uuidParam } from '../../lib/validation';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../../plugins/auth';
import type { AuthService } from './service';

const strict = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });

export function authRoutes(app: FastifyInstance, auth: AuthService) {
  app.post('/v1/auth/signup', { config: strict(5) }, async (request, reply) => {
    const input = parse(signupSchema, request.body);
    const { userId, session } = await auth.signup(input, requestMeta(request));
    setSessionCookie(app, reply, session.token, session.expiresAt);
    return reply.status(201).send(await auth.me(userId));
  });

  app.post('/v1/auth/login', { config: strict(10) }, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const { userId, session } = await auth.login(input, requestMeta(request));
    setSessionCookie(app, reply, session.token, session.expiresAt);
    return reply.send(await auth.me(userId));
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    if (request.auth) await auth.logout(request.auth.sessionId);
    clearSessionCookie(app, reply);
    return reply.status(204).send();
  });

  app.get('/v1/auth/me', async (request) => {
    const user = requireAuth(request);
    return auth.me(user.userId);
  });

  app.post('/v1/auth/password/forgot', { config: strict(5) }, async (request, reply) => {
    const { email } = parse(forgotPasswordSchema, request.body);
    await auth.requestPasswordReset(email, requestMeta(request));
    return reply.status(202).send({ ok: true, message: 'Se o e-mail estiver cadastrado, enviaremos as instruções.' });
  });

  app.post('/v1/auth/password/reset', { config: strict(10) }, async (request, reply) => {
    const { token, password } = parse(resetPasswordSchema, request.body);
    await auth.resetPassword(token, password, requestMeta(request));
    clearSessionCookie(app, reply);
    return reply.send({ ok: true });
  });

  app.post('/v1/auth/password/change', { config: strict(10) }, async (request, reply) => {
    const user = requireAuth(request);
    const { currentPassword, newPassword } = parse(changePasswordSchema, request.body);
    await auth.changePassword(user, currentPassword, newPassword, requestMeta(request));
    return reply.status(204).send();
  });

  app.post('/v1/auth/email/verify', { config: strict(10) }, async (request) => {
    const { token } = parse(verifyEmailSchema, request.body);
    await auth.verifyEmail(token);
    return { ok: true };
  });

  app.post('/v1/auth/email/resend', { config: strict(3) }, async (request, reply) => {
    const user = requireAuth(request);
    await auth.resendVerification(user.userId);
    return reply.status(202).send({ ok: true });
  });

  app.get('/v1/auth/sessions', async (request) => {
    const user = requireAuth(request);
    return { sessions: await auth.listSessions(user) };
  });

  app.delete('/v1/auth/sessions/:sessionId', async (request, reply) => {
    const user = requireAuth(request);
    const sessionId = uuidParam((request.params as { sessionId?: string }).sessionId, 'Sessão');
    await auth.revokeSession(user, sessionId);
    return reply.status(204).send();
  });
}
