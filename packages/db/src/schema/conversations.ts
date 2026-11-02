import type { EffectiveLanguage } from '@barber-voice/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, tz, updatedAt } from './_shared';
import { users } from './auth';
import { customers } from './crm';
import { tenants } from './tenancy';
import { personas } from './voice-studio';

export const conversationChannelEnum = pgEnum('conversation_channel', ['PHONE', 'WHATSAPP']);
/** OPEN = recepcionista atende; HANDOFF = aguardando/atendida pela equipe; CLOSED = encerrada. */
export const conversationStatusEnum = pgEnum('conversation_status', ['OPEN', 'HANDOFF', 'CLOSED']);
export const conversationMessageRoleEnum = pgEnum('conversation_message_role', [
  'CUSTOMER',
  'ASSISTANT',
  'STAFF',
  'SYSTEM',
  'TOOL',
]);

/**
 * Atendimento (uma ligação, uma janela de conversa no WhatsApp ou uma sessão do simulador).
 * As instruções da recepcionista são CONGELADAS no início (`system_prompt`): mudanças no
 * catálogo valem para a próxima conversa — o histórico enviado ao modelo é somente-acréscimo.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channel: conversationChannelEnum('channel').notNull(),
    status: conversationStatusEnum('status').notNull().default('OPEN'),
    /** Simulação (Voice Studio): as ferramentas consultam a agenda real, mas nada é gravado. */
    isSimulation: boolean('is_simulation').notNull().default(false),
    customerId: uuid('customer_id'),
    /** E.164 do cliente (WhatsApp/telefone). Nunca vem do modelo de IA. */
    contactPhone: text('contact_phone'),
    contactName: text('contact_name'),
    /** Identificador no provedor (ex.: id da chamada). */
    externalId: text('external_id'),
    personaId: uuid('persona_id').references(() => personas.id, { onDelete: 'set null' }),
    personaVersion: integer('persona_version'),
    instructionsHash: text('instructions_hash'),
    systemPrompt: text('system_prompt'),
    /** Linguagem efetiva congelada no início (validador de estilo usa a mesma da instrução). */
    language: jsonb('language').$type<EffectiveLanguage>(),
    model: text('model'),
    handoffReason: text('handoff_reason'),
    handoffAt: timestamp('handoff_at', tz),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    startedByUserId: uuid('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    messageCount: integer('message_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', tz).notNull().defaultNow(),
    closedAt: timestamp('closed_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('conversations_tenant_id_id_key').on(t.tenantId, t.id),
    index('conversations_tenant_recent_idx').on(t.tenantId, t.lastMessageAt),
    index('conversations_tenant_contact_idx').on(t.tenantId, t.contactPhone, t.status),
    foreignKey({
      name: 'conversations_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    check(
      'conversations_phone_e164',
      sql`${t.contactPhone} IS NULL OR ${t.contactPhone} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
  ],
);

/** Linha do tempo legível do atendimento (o que o cliente e a equipe veem, e o que as ferramentas fizeram). */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    role: conversationMessageRoleEnum('role').notNull(),
    content: text('content').notNull().default(''),
    toolName: text('tool_name'),
    toolInput: jsonb('tool_input'),
    toolOutput: jsonb('tool_output'),
    /** Resultado do verificador de afirmações/estilo para respostas da recepcionista. */
    verification: jsonb('verification'),
    /** Id da mensagem no provedor (idempotência de webhooks). */
    externalId: text('external_id'),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('conversation_messages_conv_idx').on(t.tenantId, t.conversationId, t.createdAt),
    uniqueIndex('conversation_messages_external_key')
      .on(t.tenantId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    foreignKey({
      name: 'conversation_messages_conversation_fk',
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Histórico EXATO enviado/recebido do modelo de linguagem, por rodada, somente-acréscimo.
 * Mantém blocos de raciocínio e chamadas de ferramenta byte a byte, como a API exige para
 * reaproveitar o raciocínio e o cache entre rodadas.
 */
export const conversationLlmTurns = pgTable(
  'conversation_llm_turns',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    seq: integer('seq').notNull(),
    messages: jsonb('messages').$type<unknown[]>().notNull(),
    usage: jsonb('usage'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('conversation_llm_turns_seq_key').on(t.tenantId, t.conversationId, t.seq),
    foreignKey({
      name: 'conversation_llm_turns_conversation_fk',
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete('cascade'),
  ],
);
