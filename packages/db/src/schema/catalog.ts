import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, tz, updatedAt } from './_shared';
import { users } from './auth';
import { closureKindEnum, priceTypeEnum, timeOffKindEnum } from './enums';
import { tenants } from './tenancy';

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** Horário de funcionamento semanal. Dia ISO (1 = segunda ... 7 = domingo). Várias faixas por dia. */
export const businessHours = pgTable(
  'business_hours',
  {
    id: pk(),
    tenantId: tenantRef(),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('business_hours_tenant_idx').on(t.tenantId, t.weekday),
    check('business_hours_weekday_range', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('business_hours_order', sql`${t.startTime} < ${t.endTime}`),
  ],
);

/** Fechamentos do estabelecimento inteiro: feriados, reformas, eventos, expediente reduzido. */
export const closures = pgTable(
  'closures',
  {
    id: pk(),
    tenantId: tenantRef(),
    kind: closureKindEnum('kind').notNull().default('CLOSURE'),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', tz).notNull(),
    endsAt: timestamp('ends_at', tz).notNull(),
    allDay: boolean('all_day').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('closures_tenant_range_idx').on(t.tenantId, t.startsAt),
    check('closures_order', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

export const services = pgTable(
  'services',
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'),
    durationMin: integer('duration_min').notNull(),
    bufferAfterMin: integer('buffer_after_min').notNull().default(0),
    /** Centavos. Nulo somente quando o preço é "sob consulta". */
    priceCents: integer('price_cents'),
    priceType: priceTypeEnum('price_type').notNull().default('FIXED'),
    active: boolean('active').notNull().default(true),
    /** A recepcionista de IA pode agendar este serviço sozinha. */
    bookableByAi: boolean('bookable_by_ai').notNull().default(true),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', tz),
  },
  (t) => [
    unique('services_tenant_id_id_key').on(t.tenantId, t.id),
    index('services_tenant_idx').on(t.tenantId, t.sortOrder),
    uniqueIndex('services_tenant_name_key')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    check('services_duration_range', sql`${t.durationMin} BETWEEN 5 AND 720`),
    check('services_buffer_range', sql`${t.bufferAfterMin} BETWEEN 0 AND 240`),
    check('services_price_positive', sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`),
    check('services_price_required', sql`${t.priceType} = 'ON_REQUEST' OR ${t.priceCents} IS NOT NULL`),
  ],
);

export const professionals = pgTable(
  'professionals',
  {
    id: pk(),
    tenantId: tenantRef(),
    /** Login do profissional (opcional), quando ele também acessa o painel. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    bio: text('bio'),
    email: text('email'),
    phone: text('phone'),
    color: text('color'),
    active: boolean('active').notNull().default(true),
    bookableByAi: boolean('bookable_by_ai').notNull().default(true),
    /** true = segue o horário de funcionamento; false = usa professional_working_hours. */
    usesBusinessHours: boolean('uses_business_hours').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', tz),
  },
  (t) => [
    unique('professionals_tenant_id_id_key').on(t.tenantId, t.id),
    index('professionals_tenant_idx').on(t.tenantId, t.sortOrder),
  ],
);

/** Quais serviços cada profissional realiza, com duração/preço próprios opcionais. */
export const professionalServices = pgTable(
  'professional_services',
  {
    tenantId: tenantRef(),
    professionalId: uuid('professional_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    durationMin: integer('duration_min'),
    priceCents: integer('price_cents'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.professionalId, t.serviceId] }),
    index('professional_services_tenant_idx').on(t.tenantId),
    index('professional_services_service_idx').on(t.serviceId),
    foreignKey({
      name: 'professional_services_professional_fk',
      columns: [t.tenantId, t.professionalId],
      foreignColumns: [professionals.tenantId, professionals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_services_service_fk',
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }).onDelete('cascade'),
    check('professional_services_duration_range', sql`${t.durationMin} IS NULL OR ${t.durationMin} BETWEEN 5 AND 720`),
    check('professional_services_price_positive', sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`),
  ],
);

/** Jornada semanal própria do profissional (quando não segue o horário do estabelecimento). */
export const professionalWorkingHours = pgTable(
  'professional_working_hours',
  {
    id: pk(),
    tenantId: tenantRef(),
    professionalId: uuid('professional_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('professional_working_hours_prof_idx').on(t.tenantId, t.professionalId, t.weekday),
    foreignKey({
      name: 'professional_working_hours_professional_fk',
      columns: [t.tenantId, t.professionalId],
      foreignColumns: [professionals.tenantId, professionals.id],
    }).onDelete('cascade'),
    check('professional_working_hours_weekday_range', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('professional_working_hours_order', sql`${t.startTime} < ${t.endTime}`),
  ],
);

/** Folgas, férias e bloqueios pontuais do profissional. */
export const timeOff = pgTable(
  'time_off',
  {
    id: pk(),
    tenantId: tenantRef(),
    professionalId: uuid('professional_id').notNull(),
    kind: timeOffKindEnum('kind').notNull().default('BLOCK'),
    reason: text('reason'),
    startsAt: timestamp('starts_at', tz).notNull(),
    endsAt: timestamp('ends_at', tz).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('time_off_prof_range_idx').on(t.tenantId, t.professionalId, t.startsAt),
    foreignKey({
      name: 'time_off_professional_fk',
      columns: [t.tenantId, t.professionalId],
      foreignColumns: [professionals.tenantId, professionals.id],
    }).onDelete('cascade'),
    check('time_off_order', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);
