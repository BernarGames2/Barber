import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ApiRuntime, createRuntime } from './runtime';

/**
 * Ponto de entrada da API como função da Vercel (serviço "api" do vercel.json).
 *
 * A Vercel aceita um handler `(req, res)` exportado por padrão. A instância Fastify é criada uma
 * vez por instância da função (reaproveitada entre requisições "quentes") e recebe cada requisição
 * pelo evento `request` do servidor HTTP interno — sem `listen()`.
 *
 * O caminho chega como foi publicado (`/api/v1/...`); o prefixo `/api` é removido pela própria
 * API (`API_PATH_PREFIX`), igual em todos os ambientes.
 */
export const runtime: Promise<ApiRuntime> = createRuntime().then(async (r) => {
  await r.app.ready();
  return r;
});

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { app } = await runtime;
  app.server.emit('request', req, res);
}
