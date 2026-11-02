import { type Database, tenants } from '@barber-voice/db';
import { eq } from 'drizzle-orm';
import type { TenantSettings } from '../context';

/**
 * Configurações do estabelecimento para fluxos sem usuário logado (canais de atendimento).
 * A tabela de estabelecimentos é global; o isolamento dos dados operacionais continua no RLS.
 */
export async function loadTenantSettings(db: Database, tenantId: string): Promise<TenantSettings | null> {
  const [row] = await db
    .select({
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
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row ?? null;
}
