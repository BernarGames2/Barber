import { tenants } from '@barber-voice/db';
import { eq } from 'drizzle-orm';
import type { ServiceContext } from '../src/context';
import type { TestContext } from './helpers';

/** Contexto de serviço "como a IA" (sem usuário), para testar caminhos internos. */
export async function serviceContextForTest(ctx: TestContext, tenantId: string): Promise<ServiceContext> {
  const [t] = await ctx.admin.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) throw new Error('tenant não encontrado');
  return {
    deps: ctx.app.deps,
    tenant: {
      id: t.id,
      name: t.name,
      slug: t.slug,
      timezone: t.timezone,
      status: t.status,
      slotIntervalMin: t.slotIntervalMin,
      minBookingNoticeMin: t.minBookingNoticeMin,
      maxBookingDaysAhead: t.maxBookingDaysAhead,
      cancellationMinNoticeMin: t.cancellationMinNoticeMin,
      isDemo: t.isDemo,
    },
    actor: { userId: null, role: null, type: 'AI' },
    meta: {},
  };
}
