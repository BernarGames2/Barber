import { type DbExecutor, auditLogs } from '@barber-voice/db';

export interface AuditEntry {
  tenantId: string | null;
  actorUserId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'AI' | 'PLATFORM_ADMIN';
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Registra um evento na trilha de auditoria. Deve ser chamado dentro da MESMA transação
 * da operação auditada, para que ambos sejam gravados (ou descartados) juntos.
 * Nunca inclua senhas, tokens ou conteúdo sensível em `metadata`.
 */
export async function audit(executor: DbExecutor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values({
    tenantId: entry.tenantId,
    actorUserId: entry.actorUserId ?? null,
    actorType: entry.actorType ?? 'USER',
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
