import {
  consentInputSchema,
  customerInputSchema,
  customerListQuerySchema,
  customerUpdateSchema,
} from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { serviceContext } from '../../lib/permissions';
import { parse, uuidParam } from '../../lib/validation';
import {
  anonymizeCustomer,
  createCustomer,
  getCustomer,
  listCustomers,
  recordConsent,
  updateCustomer,
} from './service';

const customerId = (params: unknown) => uuidParam((params as { customerId?: string }).customerId, 'Cliente');

export function customerRoutes(app: FastifyInstance) {
  app.get('/customers', async (request) =>
    listCustomers(serviceContext(request, 'customers:read'), parse(customerListQuerySchema, request.query)),
  );

  app.get('/customers/:customerId', async (request) =>
    getCustomer(serviceContext(request, 'customers:read'), customerId(request.params)),
  );

  app.post('/customers', async (request, reply) => {
    const ctx = serviceContext(request, 'customers:write');
    return reply.status(201).send(await createCustomer(ctx, parse(customerInputSchema, request.body)));
  });

  app.patch('/customers/:customerId', async (request) => {
    const ctx = serviceContext(request, 'customers:write');
    return updateCustomer(ctx, customerId(request.params), parse(customerUpdateSchema, request.body));
  });

  app.post('/customers/:customerId/consents', async (request) => {
    const ctx = serviceContext(request, 'customers:write');
    return {
      consents: await recordConsent(ctx, customerId(request.params), parse(consentInputSchema, request.body)),
    };
  });

  app.post('/customers/:customerId/anonymize', async (request, reply) => {
    const ctx = serviceContext(request, 'customers:anonymize');
    await anonymizeCustomer(ctx, customerId(request.params));
    return reply.status(204).send();
  });
}
