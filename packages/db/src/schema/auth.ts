import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, tz, updatedAt } from './_shared';
import { authTokenTypeEnum, platformRoleEnum } from './enums';

/** Usuários da plataforma (proprietários, gerentes, funcionários e equipe Barber Voice). Global. */
export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', tz),
    /** Somente via script administrativo; nunca pela API. */
    platformRole: platformRoleEnum('platform_role'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', tz),
    lastLoginAt: timestamp('last_login_at', tz),
    passwordChangedAt: timestamp('password_changed_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

/** Sessões opacas: o cookie carrega um token aleatório; o banco guarda apenas o SHA-256. */
export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', tz).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    revokedAt: timestamp('revoked_at', tz),
  },
  (t) => [uniqueIndex('sessions_token_hash_key').on(t.tokenHash), index('sessions_user_id_idx').on(t.userId)],
);

/** Tokens de uso único (verificação de e-mail, redefinição de senha). Guardados como hash. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: authTokenTypeEnum('type').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    usedAt: timestamp('used_at', tz),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_token_hash_key').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId, t.type)],
);
