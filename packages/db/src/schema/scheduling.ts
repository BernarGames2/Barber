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
import { professionals, services } from './catalog';
import { customers } from './crm';
import {
  appointmentSourceEnum,
  appointmentStatusEnum,
  cancelledByEnum,
  priceTypeEnum,
  waitlistStatusEnum,
} from './enums';
import { tenants } from './tenancy';

/**
 * Agendamentos. Garantias no banco (migração 0001):
 * - EXCLUDE USING gist: nenhum par de agendamentos ativos do mesmo profissional pode ter
 *   [starts_at, blocked_until) sobrepostos (salvo encaixe deliberado, `is_overbook`).
 * - FKs compostas (tenant_id, id): cliente/profissional sempre do mesmo estabelecimento.
 * - `idempotency_key` único por estabelecimento: repetições não duplicam reservas.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    professionalId: uuid('professional_id').notNull(),
    status: appointmentStatusEnum('status').notNull().default('CONFIRMED'),
    startsAt: timestamp('starts_at', tz).notNull(),
    /** Fim do atendimento (o que o cliente vê). */
    endsAt: timestamp('ends_at', tz).notNull(),
    /** Fim da ocupação da agenda: ends_at + intervalo de limpeza/preparo. */
    blockedUntil: timestamp('blocked_until', tz).notNull(),
    totalDurationMin: integer('total_duration_min').notNull(),
    /** Soma dos preços cadastrados no momento da reserva (centavos). Nulo se sob consulta. */
    totalPriceCents: integer('total_price_cents'),
    /** Algum item tem preço "a partir de" ou "sob consulta": total não é definitivo. */
    priceIsEstimate: boolean('price_is_estimate').notNull().default(false),
    source: appointmentSourceEnum('source').notNull(),
    /** Encaixe deliberado por funcionário (pode sobrepor). A IA nunca cria encaixes. */
    isOverbook: boolean('is_overbook').notNull().default(false),
    holdExpiresAt: timestamp('hold_expires_at', tz),
    notes: text('notes'),
    idempotencyKey: text('idempotency_key'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', tz),
    completedAt: timestamp('completed_at', tz),
    noShowAt: timestamp('no_show_at', tz),
    cancelledAt: timestamp('cancelled_at', tz),
    cancelledBy: cancelledByEnum('cancelled_by'),
    cancelReason: text('cancel_reason'),
    rescheduledFromId: uuid('rescheduled_from_id'),
    reminderSentAt: timestamp('reminder_sent_at', tz),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('appointments_tenant_id_id_key').on(t.tenantId, t.id),
    index('appointments_tenant_starts_idx').on(t.tenantId, t.startsAt),
    index('appointments_professional_starts_idx').on(t.tenantId, t.professionalId, t.startsAt),
    index('appointments_customer_starts_idx').on(t.tenantId, t.customerId, t.startsAt),
    index('appointments_hold_expiry_idx')
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'HELD'`),
    uniqueIndex('appointments_tenant_idempotency_key')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    foreignKey({
      name: 'appointments_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_professional_fk',
      columns: [t.tenantId, t.professionalId],
      foreignColumns: [professionals.tenantId, professionals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_rescheduled_from_fk',
      columns: [t.rescheduledFromId],
      foreignColumns: [t.id],
    }).onDelete('set null'),
    check('appointments_order', sql`${t.startsAt} < ${t.endsAt} AND ${t.endsAt} <= ${t.blockedUntil}`),
    check('appointments_duration_range', sql`${t.totalDurationMin} BETWEEN 5 AND 720`),
    check('appointments_hold_has_expiry', sql`${t.status} <> 'HELD' OR ${t.holdExpiresAt} IS NOT NULL`),
    check('appointments_price_positive', sql`${t.totalPriceCents} IS NULL OR ${t.totalPriceCents} >= 0`),
  ],
);

/** Serviços de um agendamento (ex.: corte + barba), com preço/duração congelados na reserva. */
export const appointmentItems = pgTable(
  'appointment_items',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    serviceName: text('service_name').notNull(),
    durationMin: integer('duration_min').notNull(),
    priceCents: integer('price_cents'),
    priceType: priceTypeEnum('price_type').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('appointment_items_appointment_idx').on(t.tenantId, t.appointmentId),
    index('appointment_items_service_idx').on(t.tenantId, t.serviceId),
    foreignKey({
      name: 'appointment_items_appointment_fk',
      columns: [t.tenantId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'appointment_items_service_fk',
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }).onDelete('restrict'),
  ],
);

export interface PreferredWindow {
  /** Dias ISO (1 = segunda ... 7 = domingo). Vazio = qualquer dia. */
  weekdays: number[];
  from: string;
  to: string;
}

export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    /** Profissional desejado (nulo = qualquer um). */
    professionalId: uuid('professional_id').references(() => professionals.id, { onDelete: 'set null' }),
    earliestDate: date('earliest_date').notNull(),
    latestDate: date('latest_date').notNull(),
    preferredWindows: jsonb('preferred_windows').$type<PreferredWindow[]>().notNull().default([]),
    notes: text('notes'),
    status: waitlistStatusEnum('status').notNull().default('WAITING'),
    offeredAppointmentId: uuid('offered_appointment_id'),
    offeredAt: timestamp('offered_at', tz),
    offerExpiresAt: timestamp('offer_expires_at', tz),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('waitlist_tenant_status_idx').on(t.tenantId, t.status, t.earliestDate),
    foreignKey({
      name: 'waitlist_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'waitlist_service_fk',
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }).onDelete('cascade'),
    check('waitlist_date_order', sql`${t.earliestDate} <= ${t.latestDate}`),
  ],
);
