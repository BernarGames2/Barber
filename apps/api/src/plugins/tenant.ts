import { memberships, tenants } from '@barber-voice/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AppError, Errors } from '../lib/errors';
import { uuidParam } from '../lib/validation';
import { requireAuth } from './auth';

/**
 * Pré-handler das rotas /v1/tenants/:tenantId/*.
 * - Exige sessão válida e vínculo ATIVO do usuário com o estabelecimento.
 * - Responde 404 (e não 403) quando não há vínculo: não revela se o estabelecimento existe.
 * - Estabelecimento suspenso: somente leitura.
 */
export async function resolveTenant(request: FastifyRequest): Promise<void> {
  const auth = requireAuth(request);
  const tenantId = uuidParam((request.params as { tenantId?: string }).tenantId, 'Estabelecimento');
  const { db } = request.server.deps;
  const [row] = await db
    .select({
      role: memberships.role,
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      timezone: tenants.timezone,
      status: tenants.status,
      slotIntervalMin: tenants.slotIntervalMin,
      minBookingNoticeMin: tenants.minBookingNoticeMin,
      maxBookingDaysAhead: tenants.maxBookingDaysAhead,
      cancellationMinNoticeMin: tenants.cancellationMinNoticeMin,
      isDemo: tenants.isDemo,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(
        eq(memberships.userId, auth.userId),
        eq(memberships.tenantId, tenantId),
        eq(memberships.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  if (!row || row.status === 'CANCELLED') throw Errors.notFound('Estabelecimento');
  if (row.status === 'SUSPENDED' && request.method !== 'GET') {
    throw new AppError(
      403,
      'TENANT_SUSPENDED',
      'Esta conta está suspensa. Fale com o suporte do Barber Voice.',
    );
  }
  const { role, ...tenant } = row;
  request.tenantCtx = { tenantId: row.id, role, tenant };
}
