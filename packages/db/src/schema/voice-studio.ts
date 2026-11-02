import type { PersonaDefinition } from '@barber-voice/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { users } from './auth';
import { tenants } from './tenancy';

export const formalityEnum = pgEnum('formality', ['FORMAL', 'SEMIFORMAL', 'INFORMAL']);
export const slangLevelEnum = pgEnum('slang_level', ['NONE', 'LOW', 'MODERATE', 'HIGH']);
export const customerNameUsageEnum = pgEnum('customer_name_usage', ['NEVER', 'GREETING', 'NATURAL']);
export const personaSegmentEnum = pgEnum('persona_segment', ['BARBERSHOP', 'SALON', 'ANY']);

/**
 * Personagens. `tenant_id` nulo = biblioteca da plataforma (legível por todos, gravável só pelo
 * papel dono); preenchido = personagem própria do estabelecimento (RLS). A definição completa
 * fica em JSONB versionado: novas personagens são DADOS, não código.
 */
export const personas = pgTable(
  'personas',
  {
    id: pk(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    name: text('name').notNull(),
    segment: personaSegmentEnum('segment').notNull(),
    definition: jsonb('definition').$type<PersonaDefinition>().notNull(),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('personas_library_key')
      .on(t.key)
      .where(sql`${t.tenantId} IS NULL`),
    uniqueIndex('personas_tenant_key')
      .on(t.tenantId, t.key)
      .where(sql`${t.tenantId} IS NOT NULL`),
    index('personas_tenant_idx').on(t.tenantId),
  ],
);

/** Configuração da recepcionista do estabelecimento (uma por estabelecimento). */
export const receptionistConfigs = pgTable(
  'receptionist_configs',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'restrict' }),
    /** Versão da personagem no momento da escolha (mudanças na biblioteca não alteram silenciosamente). */
    personaVersion: integer('persona_version').notNull(),
    receptionistName: text('receptionist_name'),
    /** Identificador da voz no provedor de TTS (definido quando houver provedor configurado). */
    voiceId: text('voice_id'),
    formality: formalityEnum('formality').notNull().default('SEMIFORMAL'),
    slangLevel: slangLevelEnum('slang_level').notNull().default('LOW'),
    emojisEnabled: boolean('emojis_enabled').notNull().default(false),
    enthusiasm: smallint('enthusiasm').notNull().default(3),
    relaxation: smallint('relaxation').notNull().default(3),
    useCustomerName: customerNameUsageEnum('use_customer_name').notNull().default('GREETING'),
    greeting: text('greeting'),
    farewell: text('farewell'),
    signatureExpressions: text('signature_expressions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    vocabularyPrefer: text('vocabulary_prefer')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    vocabularyAvoid: text('vocabulary_avoid')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    businessInstructions: text('business_instructions'),
    version: integer('version').notNull().default(1),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('receptionist_enthusiasm_range', sql`${t.enthusiasm} BETWEEN 1 AND 5`),
    check('receptionist_relaxation_range', sql`${t.relaxation} BETWEEN 1 AND 5`),
  ],
);
