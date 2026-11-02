import {
  appointmentListQuerySchema,
  appointmentStatusUpdateSchema,
  availabilityQuerySchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  optionalText,
  rescheduleAppointmentSchema,
} from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serviceContext } from '../../lib/permissions';
import { parse, uuidParam } from '../../lib/validation';
import { getAvailability } from './availability';
import {
  cancelAppointment,
  createAppointment,
  getAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointmentNotes,
  updateAppointmentStatus,
} from './booking';

const appointmentId = (params: unknown) => uuidParam((params as { appointmentId?: string }).appointmentId, 'Agendamento');

export function appointmentRoutes(app: FastifyInstance) {
  app.get('/availability', async (request) => {
    const ctx = serviceContext(request, 'tenant:read');
    const q = parse(availabilityQuerySchema, request.query);
    return getAvailability(ctx, q);
  });

  app.get('/appointments', async (request) => {
    const ctx = serviceContext(request, 'tenant:read');
    return { appointments: await listAppointments(ctx, parse(appointmentListQuerySchema, request.query)) };
  });

  app.get('/appointments/:appointmentId', async (request) =>
    getAppointment(serviceContext(request, 'tenant:read'), appointmentId(request.params)),
  );

  app.post('/appointments', async (request, reply) => {
    const ctx = serviceContext(request, 'appointments:write');
    const input = parse(createAppointmentSchema, request.body);
    const idempotencyKey = request.headers['idempotency-key'];
    const result = await createAppointment(
      ctx,
      { ...input, source: input.source },
      { idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null },
    );
    return reply
      .status(result.replayed ? 200 : 201)
      .header('Idempotent-Replayed', result.replayed ? 'true' : 'false')
      .send(result.appointment);
  });

  app.post('/appointments/:appointmentId/cancel', async (request) => {
    const ctx = serviceContext(request, 'appointments:write');
    const input = parse(cancelAppointmentSchema, request.body);
    return cancelAppointment(ctx, appointmentId(request.params), input);
  });

  app.post('/appointments/:appointmentId/reschedule', async (request) => {
    const ctx = serviceContext(request, 'appointments:write');
    return rescheduleAppointment(ctx, appointmentId(request.params), parse(rescheduleAppointmentSchema, request.body));
  });

  app.post('/appointments/:appointmentId/status', async (request) => {
    const ctx = serviceContext(request, 'appointments:write');
    const { status } = parse(appointmentStatusUpdateSchema, request.body);
    return updateAppointmentStatus(ctx, appointmentId(request.params), status);
  });

  app.patch('/appointments/:appointmentId', async (request) => {
    const ctx = serviceContext(request, 'appointments:write');
    const { notes } = parse(z.object({ notes: optionalText(1000) }), request.body);
    return updateAppointmentNotes(ctx, appointmentId(request.params), notes ?? null);
  });
}
