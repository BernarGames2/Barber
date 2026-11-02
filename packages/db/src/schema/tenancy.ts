import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, tz, updatedAt } from './_shared';
import { users } from './auth';
import { businessCategoryEnum, memberRoleEnum, membershipStatusEnum, tenantStatusEnum } from './enums';

/**
 * Organização = entidade comercial que assina o plano. Pode ter uma ou várias unidades
 * (tenants). No Start/Pro há uma unidade; no Enterprise, redes com múltiplas unidades.
 */
export const organizations = pgTable('organizations', {
  id: pk(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Tenant = estabelecimento (unidade). É a fronteira de isolamento de dados:
 * todas as tabelas operacionais têm `tenant_id` + Row-Level Security.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    category: businessCategoryEnum('category').notNull(),
    status: tenantStatusEnum('status').notNull().default('ONBOARDING'),
    legalName: text('legal_name'),
    document: text('document'),
    responsibleName: text('responsible_name'),
    phone: text('phone'),
    whatsappNumber: text('whatsapp_number'),
    email: text('email'),
    addressStreet: text('address_street'),
    addressNumber: text('address_number'),
    addressComplement: text('address_complement'),
    addressDistrict: text('address_district'),
    addressCity: text('address_city'),
    addressState: text('address_state'),
    addressPostalCode: text('address_postal_code'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    locale: text('locale').notNull().default('pt-BR'),
    currency: text('currency').notNull().default('BRL'),
    /** Grade de horários oferecidos (minutos). */
    slotIntervalMin: integer('slot_interval_min').notNull().default(30),
    /** Antecedência mínima para agendar (minutos). */
    minBookingNoticeMin: integer('min_booking_notice_min').notNull().default(60),
    /** Limite de dias à frente para agendar. */
    maxBookingDaysAhead: integer('max_booking_days_ahead').notNull().default(60),
    /** Antecedência mínima para o CLIENTE cancelar/remarcar sozinho (via IA). 0 = sem restrição. */
    cancellationMinNoticeMin: integer('cancellation_min_notice_min').notNull().default(0),
    onboardingStep: text('onboarding_step'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', tz),
    /** Interruptor geral da recepcionista de IA. */
    aiEnabled: boolean('ai_enabled').notNull().default(false),
    /** Estabelecimento de demonstração (dados fictícios claramente identificados). */
    isDemo: boolean('is_demo').notNull().default(false),
    suspendedAt: timestamp('suspended_at', tz),
    suspensionReason: text('suspension_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    index('tenants_organization_idx').on(t.organizationId),
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'`),
    check('tenants_slot_interval_range', sql`${t.slotIntervalMin} BETWEEN 5 AND 240`),
    check('tenants_notice_range', sql`${t.minBookingNoticeMin} BETWEEN 0 AND 10080`),
    check('tenants_days_ahead_range', sql`${t.maxBookingDaysAhead} BETWEEN 1 AND 365`),
    check('tenants_cancel_notice_range', sql`${t.cancellationMinNoticeMin} BETWEEN 0 AND 10080`),
  ],
);

/** Vínculo usuário ↔ estabelecimento com papel. Um usuário pode ter vários estabelecimentos. */
export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('ACTIVE'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_key').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

/** Convites para a equipe. Token guardado como hash; aceite exige login com o e-mail convidado. */
export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRoleEnum('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', tz).notNull(),
    acceptedAt: timestamp('accepted_at', tz),
    revokedAt: timestamp('revoked_at', tz),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    index('invitations_tenant_idx').on(t.tenantId),
  ],
);
