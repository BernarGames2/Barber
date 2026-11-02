import type { LoginInput, MeResponse, SignupInput } from '@barber-voice/contracts';
import { PG_ERROR, authTokens, memberships, pgErrorCode, sessions, tenants, users } from '@barber-voice/db';
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { AppDeps, AuthContext } from '../../context';
import { audit } from '../../lib/audit';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError, Errors } from '../../lib/errors';
import { getDummyHash, hashPassword, verifyPassword } from '../../lib/password';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
const SESSION_TOUCH_MS = 5 * MINUTE;
const RESET_TTL_MS = 60 * MINUTE;
const VERIFY_TTL_MS = 2 * DAY;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');

export function createAuthService(deps: AppDeps) {
  const { db, config, clock, mailer } = deps;

  async function createSession(userId: string, meta: RequestMeta): Promise<CreatedSession> {
    const token = randomToken();
    const now = clock();
    const expiresAt = new Date(now.getTime() + config.SESSION_TTL_DAYS * DAY);
    const [s] = await db
      .insert(sessions)
      .values({
        userId,
        tokenHash: sha256(token),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      })
      .returning({ id: sessions.id });
    return { token, sessionId: s!.id, expiresAt };
  }

  async function issueToken(userId: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET', ttlMs: number) {
    const token = randomToken();
    const now = clock();
    // invalida tokens anteriores do mesmo tipo ainda não usados
    await db
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.type, type), isNull(authTokens.usedAt)));
    await db.insert(authTokens).values({
      userId,
      type,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + ttlMs),
      createdAt: now,
    });
    return token;
  }

  async function consumeToken(token: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
    const now = clock();
    // consumo atômico: só um uso concorrente vence
    const [row] = await db
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.tokenHash, sha256(token)),
          eq(authTokens.type, type),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, now),
        ),
      )
      .returning({ userId: authTokens.userId });
    return row?.userId ?? null;
  }

  async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
    const token = await issueToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TTL_MS);
    await mailer.send({
      kind: 'email_verification',
      to: user.email,
      subject: 'Confirme seu e-mail no Barber Voice',
      text: `Olá, ${user.name}!\n\nConfirme seu e-mail acessando:\n${config.PUBLIC_WEB_URL}/confirmar-email?token=${token}\n\nO link vale por 48 horas.`,
    });
  }

  return {
    createSession,

    async signup(input: SignupInput, meta: RequestMeta) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing[0]) {
        throw Errors.conflict(
          'EMAIL_IN_USE',
          'Já existe uma conta com este e-mail. Entre ou recupere sua senha.',
        );
      }
      const passwordHash = await hashPassword(input.password);
      const now = clock();
      let user: typeof users.$inferSelect;
      try {
        const [row] = await db
          .insert(users)
          .values({
            email: input.email,
            name: input.name,
            passwordHash,
            passwordChangedAt: now,
            createdAt: now,
          })
          .returning();
        user = row!;
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
          throw Errors.conflict(
            'EMAIL_IN_USE',
            'Já existe uma conta com este e-mail. Entre ou recupere sua senha.',
          );
        }
        throw err;
      }
      await audit(db, {
        tenantId: null,
        actorUserId: user.id,
        action: 'auth.signup',
        entityType: 'user',
        entityId: user.id,
        metadata: { termsAcceptedAt: now.toISOString() },
        ...meta,
      });
      await sendVerificationEmail(user);
      const session = await createSession(user.id, meta);
      return { userId: user.id, session };
    },

    async login(input: LoginInput, meta: RequestMeta) {
      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (!user) {
        await verifyPassword(await getDummyHash(), input.password); // tempo constante
        throw invalidCredentials();
      }
      const now = clock();
      if (user.lockedUntil && user.lockedUntil > now) {
        await audit(db, { tenantId: null, actorUserId: user.id, action: 'auth.login_blocked', ...meta });
        throw new AppError(
          429,
          'ACCOUNT_LOCKED',
          'Conta bloqueada temporariamente por excesso de tentativas. Aguarde alguns minutos ou redefina sua senha.',
        );
      }
      const ok = await verifyPassword(user.passwordHash, input.password);
      if (!ok) {
        const [updated] = await db
          .update(users)
          .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
          .where(eq(users.id, user.id))
          .returning({ failed: users.failedLoginCount });
        if ((updated?.failed ?? 0) >= MAX_FAILED_LOGINS) {
          await db
            .update(users)
            .set({ failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * MINUTE) })
            .where(eq(users.id, user.id));
          await audit(db, { tenantId: null, actorUserId: user.id, action: 'auth.account_locked', ...meta });
        } else {
          await audit(db, { tenantId: null, actorUserId: user.id, action: 'auth.login_failed', ...meta });
        }
        throw invalidCredentials();
      }
      await db
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(users.id, user.id));
      await audit(db, { tenantId: null, actorUserId: user.id, action: 'auth.login', ...meta });
      const session = await createSession(user.id, meta);
      return { userId: user.id, session };
    },

    async logout(sessionId: string) {
      await db.update(sessions).set({ revokedAt: clock() }).where(eq(sessions.id, sessionId));
    },

    async resolveSession(token: string): Promise<AuthContext | null> {
      if (!token || token.length > 200) return null;
      const now = clock();
      const [row] = await db
        .select({
          sessionId: sessions.id,
          userId: users.id,
          email: users.email,
          name: users.name,
          platformRole: users.platformRole,
          expiresAt: sessions.expiresAt,
          lastSeenAt: sessions.lastSeenAt,
          revokedAt: sessions.revokedAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, sha256(token)))
        .limit(1);
      if (!row || row.revokedAt || row.expiresAt <= now) return null;
      if (now.getTime() - row.lastSeenAt.getTime() > config.SESSION_IDLE_DAYS * DAY) return null;
      if (now.getTime() - row.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
        void db
          .update(sessions)
          .set({ lastSeenAt: now })
          .where(eq(sessions.id, row.sessionId))
          .catch(() => undefined);
      }
      return {
        sessionId: row.sessionId,
        userId: row.userId,
        email: row.email,
        name: row.name,
        platformRole: row.platformRole,
      };
    },

    async me(userId: string): Promise<MeResponse> {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw Errors.unauthorized();
      const rows = await db
        .select({
          tenantId: tenants.id,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          role: memberships.role,
          tenantStatus: tenants.status,
          onboardingCompletedAt: tenants.onboardingCompletedAt,
          isDemo: tenants.isDemo,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.status, 'ACTIVE'),
            ne(tenants.status, 'CANCELLED'),
          ),
        )
        .orderBy(asc(tenants.createdAt));
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: Boolean(user.emailVerifiedAt),
          isPlatformAdmin: user.platformRole === 'SUPERADMIN',
        },
        memberships: rows.map((r) => ({
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          tenantSlug: r.tenantSlug,
          role: r.role,
          tenantStatus: r.tenantStatus,
          onboardingCompleted: Boolean(r.onboardingCompletedAt),
          isDemo: r.isDemo,
        })),
      };
    },

    /** Sempre responde igual, exista ou não a conta (não revela e-mails cadastrados). */
    async requestPasswordReset(email: string, meta: RequestMeta) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) return;
      const now = clock();
      const [recent] = await db
        .select({ createdAt: authTokens.createdAt })
        .from(authTokens)
        .where(and(eq(authTokens.userId, user.id), eq(authTokens.type, 'PASSWORD_RESET')))
        .orderBy(sql`${authTokens.createdAt} DESC`)
        .limit(1);
      if (recent && now.getTime() - recent.createdAt.getTime() < MINUTE) return; // evita bombardeio de e-mails
      const token = await issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
      await audit(db, {
        tenantId: null,
        actorUserId: user.id,
        action: 'auth.password_reset_requested',
        ...meta,
      });
      await mailer.send({
        kind: 'password_reset',
        to: user.email,
        subject: 'Redefinição de senha — Barber Voice',
        text: `Olá, ${user.name}!\n\nRecebemos um pedido para redefinir sua senha. Acesse:\n${config.PUBLIC_WEB_URL}/redefinir-senha?token=${token}\n\nO link vale por 1 hora e só pode ser usado uma vez. Se não foi você, ignore este e-mail.`,
      });
    },

    async resetPassword(token: string, newPassword: string, meta: RequestMeta) {
      const userId = await consumeToken(token, 'PASSWORD_RESET');
      if (!userId)
        throw new AppError(400, 'INVALID_TOKEN', 'Link inválido ou expirado. Solicite uma nova redefinição.');
      const now = clock();
      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(newPassword),
          passwordChangedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, userId));
      // encerra todas as sessões: quem tinha a senha antiga perde o acesso
      await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await audit(db, { tenantId: null, actorUserId: userId, action: 'auth.password_reset', ...meta });
    },

    async changePassword(auth: AuthContext, current: string, next: string, meta: RequestMeta) {
      const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
      if (!user || !(await verifyPassword(user.passwordHash, current))) {
        throw new AppError(400, 'INVALID_PASSWORD', 'Senha atual incorreta.');
      }
      const now = clock();
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(next), passwordChangedAt: now })
        .where(eq(users.id, user.id));
      await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(
          and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), ne(sessions.id, auth.sessionId)),
        );
      await audit(db, { tenantId: null, actorUserId: user.id, action: 'auth.password_changed', ...meta });
    },

    async verifyEmail(token: string) {
      const userId = await consumeToken(token, 'EMAIL_VERIFICATION');
      if (!userId) throw new AppError(400, 'INVALID_TOKEN', 'Link inválido ou expirado.');
      await db.update(users).set({ emailVerifiedAt: clock() }).where(eq(users.id, userId));
    },

    async resendVerification(userId: string) {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user || user.emailVerifiedAt) return;
      await sendVerificationEmail(user);
    },

    async listSessions(auth: AuthContext) {
      const now = clock();
      const rows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
        .orderBy(sql`${sessions.lastSeenAt} DESC`);
      return rows.map((s) => ({
        id: s.id,
        current: s.id === auth.sessionId,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      }));
    },

    async revokeSession(auth: AuthContext, sessionId: string) {
      const updated = await db
        .update(sessions)
        .set({ revokedAt: clock() })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      if (!updated[0]) throw Errors.notFound('Sessão');
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
