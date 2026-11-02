import {
  conversationListQuerySchema,
  customerMessageSchema,
  startSimulationSchema,
} from '@barber-voice/contracts';
import type { FastifyInstance } from 'fastify';
import { serviceContext } from '../../lib/permissions';
import { parse, uuidParam } from '../../lib/validation';
import {
  closeConversation,
  getConversation,
  getReceptionistStatus,
  listConversations,
  returnConversationToAi,
  sendSimulatorMessage,
  startSimulation,
  takeOverConversation,
} from './service';

type IdParams = { Params: { conversationId: string } };

export function receptionistRoutes(app: FastifyInstance) {
  app.get('/receptionist/status', async (request) =>
    getReceptionistStatus(serviceContext(request, 'tenant:read')),
  );

  // conversas contêm dados de clientes: mesma permissão de leitura do CRM
  app.get('/conversations', async (request) =>
    listConversations(
      serviceContext(request, 'customers:read'),
      parse(conversationListQuerySchema, request.query),
    ),
  );
  app.get<IdParams>('/conversations/:conversationId', async (request) =>
    getConversation(
      serviceContext(request, 'customers:read'),
      uuidParam(request.params.conversationId, 'Conversa'),
    ),
  );
  app.post<IdParams>('/conversations/:conversationId/take-over', async (request) =>
    takeOverConversation(
      serviceContext(request, 'customers:write'),
      uuidParam(request.params.conversationId, 'Conversa'),
    ),
  );
  app.post<IdParams>('/conversations/:conversationId/return-to-ai', async (request) =>
    returnConversationToAi(
      serviceContext(request, 'customers:write'),
      uuidParam(request.params.conversationId, 'Conversa'),
    ),
  );
  app.post<IdParams>('/conversations/:conversationId/close', async (request) =>
    closeConversation(
      serviceContext(request, 'customers:write'),
      uuidParam(request.params.conversationId, 'Conversa'),
    ),
  );

  // simulador do Voice Studio (agenda real, sem gravações)
  app.post('/simulator/conversations', async (request, reply) => {
    const ctx = serviceContext(request, 'ai:configure');
    return reply.status(201).send(await startSimulation(ctx, parse(startSimulationSchema, request.body)));
  });
  app.post<IdParams>('/simulator/conversations/:conversationId/messages', async (request) => {
    const ctx = serviceContext(request, 'ai:configure');
    const { text } = parse(customerMessageSchema, request.body);
    return sendSimulatorMessage(ctx, uuidParam(request.params.conversationId, 'Conversa'), text);
  });
}
