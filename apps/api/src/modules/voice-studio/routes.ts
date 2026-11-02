import {
  customPersonaSchema,
  instructionsPreviewSchema,
  receptionistConfigSchema,
} from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { serviceContext } from '../../lib/permissions';
import { parse } from '../../lib/validation';
import { createCustomPersona, getVoiceStudio, previewInstructions, saveReceptionistConfig } from './service';

export function voiceStudioRoutes(app: FastifyInstance) {
  app.get('/voice-studio', async (request) => getVoiceStudio(serviceContext(request, 'tenant:read')));

  app.put('/voice-studio/config', async (request) => {
    const ctx = serviceContext(request, 'ai:configure');
    return saveReceptionistConfig(ctx, parse(receptionistConfigSchema, request.body));
  });

  app.post('/voice-studio/preview', async (request) => {
    const ctx = serviceContext(request, 'ai:configure');
    return previewInstructions(ctx, parse(instructionsPreviewSchema, request.body));
  });

  app.post('/voice-studio/personas', async (request, reply) => {
    const ctx = serviceContext(request, 'ai:configure');
    return reply.status(201).send(await createCustomPersona(ctx, parse(customPersonaSchema, request.body)));
  });
}
