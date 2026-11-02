import { businessHoursInputSchema, closureInputSchema, createTenantSchema, updateTenantSchema } from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { requestMeta, serviceContext } from '../../lib/permissions';
import { parse, uuidParam } from '../../lib/validation';
import { requireAuth } from '../../plugins/auth';
import {
  completeOnboarding,
  createClosure,
  createTenant,
  deleteClosure,
  getBusinessHours,
  getOnboardingStatus,
  getTenant,
  listClosures,
  setBusinessHours,
  updateTenant,
} from './service';

/** Criação de estabelecimento (fora do escopo de tenant: o usuário ainda não tem vínculo). */
export function tenantCreationRoutes(app: FastifyInstance) {
  app.post('/v1/tenants', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parse(createTenantSchema, request.body);
    const tenant = await createTenant(app.deps, auth, input, requestMeta(request));
    return reply.status(201).send(tenant);
  });
}

/** Rotas registradas sob /v1/tenants/:tenantId (com resolveTenant). */
export function tenantRoutes(app: FastifyInstance) {
  app.get('/', async (request) => getTenant(serviceContext(request, 'tenant:read')));

  app.patch('/', async (request) => {
    const ctx = serviceContext(request, 'tenant:write');
    return updateTenant(ctx, parse(updateTenantSchema, request.body));
  });

  app.get('/business-hours', async (request) => ({
    intervals: await getBusinessHours(serviceContext(request, 'tenant:read')),
  }));

  app.put('/business-hours', async (request) => {
    const ctx = serviceContext(request, 'schedule:write');
    const { intervals } = parse(businessHoursInputSchema, request.body);
    return { intervals: await setBusinessHours(ctx, intervals) };
  });

  app.get('/closures', async (request) => {
    const all = (request.query as { all?: string }).all === 'true';
    return { closures: await listClosures(serviceContext(request, 'tenant:read'), !all) };
  });

  app.post('/closures', async (request, reply) => {
    const ctx = serviceContext(request, 'schedule:write');
    const closure = await createClosure(ctx, parse(closureInputSchema, request.body));
    return reply.status(201).send(closure);
  });

  app.delete('/closures/:closureId', async (request, reply) => {
    const ctx = serviceContext(request, 'schedule:write');
    await deleteClosure(ctx, uuidParam((request.params as { closureId?: string }).closureId, 'Fechamento'));
    return reply.status(204).send();
  });

  app.get('/onboarding', async (request) => getOnboardingStatus(serviceContext(request, 'tenant:read')));

  app.post('/onboarding/complete', async (request) => completeOnboarding(serviceContext(request, 'tenant:write')));
}
