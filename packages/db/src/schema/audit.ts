import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';

/**
 * Trilha de auditoria. Para o papel da aplicação é SOMENTE INSERÇÃO (sem UPDATE/DELETE),
 * e cada estabelecimento só lê os próprios registros (RLS). `tenant_id` nulo = evento de
 * plataforma (ex.: login), visível apenas ao superadmin.
 * Sem FK para tenants: a trilha sobrevive à exclusão do estabelecimento, conforme a política de retenção.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    tenantId: uuid('tenant_id'),
    actorUserId: uuid('actor_user_id'),
    /** USER | SYSTEM | AI | PLATFORM_ADMIN */
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_tenant_idx').on(t.tenantId, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);
