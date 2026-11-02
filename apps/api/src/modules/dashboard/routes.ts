import { localDateSchema } from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serviceContext } from '../../lib/permissions';
import { parse } from '../../lib/validation';
import { getDashboardSummary } from './service';

export function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/summary', async (request) => {
    const ctx = serviceContext(request, 'dashboard:read');
    const { date } = parse(z.object({ date: localDateSchema.optional() }), request.query);
    return getDashboardSummary(ctx, date);
  });
}
