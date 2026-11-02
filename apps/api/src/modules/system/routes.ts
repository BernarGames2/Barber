import { CATEGORY_LABELS } from '@barber-voice/contracts';
import { BRAZIL_TIMEZONES } from '@barber-voice/core';
import { plans } from '@barber-voice/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export function systemRoutes(app: FastifyInstance) {
  /** Liveness: o processo está de pé. */
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  /** Readiness: dependências críticas respondem (usado pelo orquestrador/balanceador). */
  app.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const started = Date.now();
    try {
      await app.deps.db.execute(sql`SELECT 1`);
      return { status: 'ready', db: { ok: true, latencyMs: Date.now() - started } };
    } catch (err) {
      app.log.error({ err }, 'readiness: banco indisponível');
      return reply.status(503).send({ status: 'unavailable', db: { ok: false } });
    }
  });

  /** Dados públicos de apoio aos formulários (categorias, fusos e planos públicos). */
  app.get('/v1/meta', async () => {
    const publicPlans = await app.deps.db
      .select({
        code: plans.code,
        name: plans.name,
        description: plans.description,
        priceCents: plans.priceCents,
        limits: plans.limits,
        features: plans.features,
      })
      .from(plans)
      .where(and(eq(plans.isPublic, true), eq(plans.active, true)))
      .orderBy(asc(plans.sortOrder));
    return {
      categories: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
      timezones: BRAZIL_TIMEZONES,
      plans: publicPlans,
    };
  });
}
