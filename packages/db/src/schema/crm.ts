import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, tz, updatedAt } from './_shared';
import { users } from './auth';
import { professionals } from './catalog';
import { consentPurposeEnum, customerSourceEnum } from './enums';
import { tenants } from './tenancy';

export interface CustomerPreferences {
  /** Observações de estilo autorizadas pelo cliente (ex.: "degradê baixo"). */
  style?: string;
  /** Bebida, conversa etc. — sempre informações que o cliente aceitou registrar. */
  other?: string;
}

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** E.164 (ex.: +5511987654321). */
    phone: text('phone'),
    email: text('email'),
    birthDate: date('birth_date'),
    /** Observações internas autorizadas. Não são lidas para o cliente pela IA. */
    notes: text('notes'),
    preferences: jsonb('preferences').$type<CustomerPreferences>().notNull().default({}),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    source: customerSourceEnum('source').notNull().default('DASHBOARD'),
    preferredProfessionalId: uuid('preferred_professional_id').references(() => professionals.id, {
      onDelete: 'set null',
    }),
    firstVisitAt: timestamp('first_visit_at', tz),
    lastVisitAt: timestamp('last_visit_at', tz),
    visitsCount: integer('visits_count').notNull().default(0),
    noShowCount: integer('no_show_count').notNull().default(0),
    cancellationCount: integer('cancellation_count').notNull().default(0),
    /** LGPD: dados pessoais removidos, histórico agregado preservado. */
    anonymizedAt: timestamp('anonymized_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('customers_tenant_id_id_key').on(t.tenantId, t.id),
    index('customers_tenant_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('customers_tenant_phone_key')
      .on(t.tenantId, t.phone)
      .where(sql`${t.phone} IS NOT NULL AND ${t.anonymizedAt} IS NULL`),
    check('customers_phone_e164', sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

/**
 * Registro de consentimentos (LGPD). Somente inserção: o estado atual de cada finalidade
 * é o registro mais recente. Mantém evidência de quando, como e por quem foi registrado.
 */
export const consents = pgTable(
  'consents',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    purpose: consentPurposeEnum('purpose').notNull(),
    granted: boolean('granted').notNull(),
    channel: text('channel').notNull(),
    evidence: text('evidence'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('consents_customer_idx').on(t.tenantId, t.customerId, t.purpose, t.createdAt),
    foreignKey({
      name: 'consents_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }).onDelete('cascade'),
  ],
);
