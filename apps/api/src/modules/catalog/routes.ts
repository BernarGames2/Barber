import {
  instantSchema,
  professionalInputSchema,
  professionalScheduleSchema,
  professionalServicesSchema,
  professionalUpdateSchema,
  serviceInputSchema,
  serviceUpdateSchema,
  timeOffInputSchema,
  uuidSchema,
} from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serviceContext } from '../../lib/permissions';
import { parse, uuidParam } from '../../lib/validation';
import {
  archiveProfessional,
  createProfessional,
  getProfessional,
  listProfessionals,
  setProfessionalSchedule,
  setProfessionalServices,
  updateProfessional,
} from './professionals';
import { archiveService, createService, listServices, updateService } from './services';
import { createTimeOff, deleteTimeOff, listTimeOff } from './time-off';

const idOf = (params: unknown, key: string, what: string) =>
  uuidParam((params as Record<string, string>)[key], what);

const timeOffQuerySchema = z.object({
  from: instantSchema,
  to: instantSchema,
  professionalId: uuidSchema.optional(),
});

export function catalogRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ serviços
  app.get('/services', async (request) => {
    const activeOnly = (request.query as { active?: string }).active === 'true';
    return { services: await listServices(serviceContext(request, 'tenant:read'), !activeOnly) };
  });

  app.post('/services', async (request, reply) => {
    const ctx = serviceContext(request, 'catalog:write');
    return reply.status(201).send(await createService(ctx, parse(serviceInputSchema, request.body)));
  });

  app.patch('/services/:serviceId', async (request) => {
    const ctx = serviceContext(request, 'catalog:write');
    return updateService(
      ctx,
      idOf(request.params, 'serviceId', 'Serviço'),
      parse(serviceUpdateSchema, request.body),
    );
  });

  app.delete('/services/:serviceId', async (request, reply) => {
    const ctx = serviceContext(request, 'catalog:write');
    await archiveService(ctx, idOf(request.params, 'serviceId', 'Serviço'));
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ profissionais
  app.get('/professionals', async (request) => ({
    professionals: await listProfessionals(serviceContext(request, 'tenant:read')),
  }));

  app.get('/professionals/:professionalId', async (request) =>
    getProfessional(
      serviceContext(request, 'tenant:read'),
      idOf(request.params, 'professionalId', 'Profissional'),
    ),
  );

  app.post('/professionals', async (request, reply) => {
    const ctx = serviceContext(request, 'catalog:write');
    return reply
      .status(201)
      .send(await createProfessional(ctx, parse(professionalInputSchema, request.body)));
  });

  app.patch('/professionals/:professionalId', async (request) => {
    const ctx = serviceContext(request, 'catalog:write');
    return updateProfessional(
      ctx,
      idOf(request.params, 'professionalId', 'Profissional'),
      parse(professionalUpdateSchema, request.body),
    );
  });

  app.put('/professionals/:professionalId/schedule', async (request) => {
    const ctx = serviceContext(request, 'schedule:write');
    const { workingHours } = parse(professionalScheduleSchema, request.body);
    return setProfessionalSchedule(ctx, idOf(request.params, 'professionalId', 'Profissional'), workingHours);
  });

  app.put('/professionals/:professionalId/services', async (request) => {
    const ctx = serviceContext(request, 'catalog:write');
    const { services } = parse(professionalServicesSchema, request.body);
    return setProfessionalServices(ctx, idOf(request.params, 'professionalId', 'Profissional'), services);
  });

  app.delete('/professionals/:professionalId', async (request, reply) => {
    const ctx = serviceContext(request, 'catalog:write');
    await archiveProfessional(ctx, idOf(request.params, 'professionalId', 'Profissional'));
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ folgas / bloqueios
  app.get('/time-off', async (request) => {
    const ctx = serviceContext(request, 'tenant:read');
    const q = parse(timeOffQuerySchema, request.query);
    return {
      timeOff: await listTimeOff(ctx, {
        from: new Date(q.from),
        to: new Date(q.to),
        professionalId: q.professionalId,
      }),
    };
  });

  app.post('/time-off', async (request, reply) => {
    const ctx = serviceContext(request, 'schedule:write');
    const force = (request.query as { force?: string }).force === 'true';
    return reply.status(201).send(await createTimeOff(ctx, parse(timeOffInputSchema, request.body), force));
  });

  app.delete('/time-off/:timeOffId', async (request, reply) => {
    const ctx = serviceContext(request, 'schedule:write');
    await deleteTimeOff(ctx, idOf(request.params, 'timeOffId', 'Bloqueio'));
    return reply.status(204).send();
  });
}
