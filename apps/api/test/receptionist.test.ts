import {
  appointments,
  conversationLlmTurns,
  conversationMessages,
  conversations,
  customers,
} from '@barber-voice/db';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceContext } from '../src/context';
import { loadTenantSettings } from '../src/lib/tenant-settings';
import { SAFE_REPLIES, handleCustomerMessage } from '../src/modules/receptionist/engine';
import {
  type LlmClient,
  type LlmMessage,
  type LlmRequest,
  type LlmResponse,
  LlmUnavailableError,
  createLlmClient,
} from '../src/modules/receptionist/llm';
import { aiContext, openChannelConversation } from '../src/modules/receptionist/service';
import {
  MONDAY_10AM,
  type ShopFixture,
  type TestClient,
  type TestContext,
  createTestContext,
  json,
  setupShop,
  signup,
} from './helpers';

/**
 * Modelo ROTEIRIZADO — dublê usado somente nos testes. Cada passo recebe a requisição
 * (para ler resultados de ferramentas) e devolve uma resposta no formato da API.
 * Nenhum provedor real é chamado.
 */
type Step = (req: LlmRequest) => LlmResponse | Error;

class ScriptedLlm implements LlmClient {
  readonly provider = 'roteiro-de-teste';
  readonly model = 'modelo-roteirizado';
  requests: LlmRequest[] = [];
  private steps: Step[] = [];
  push(...steps: Step[]) {
    this.steps.push(...steps);
  }
  get pending() {
    return this.steps.length;
  }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps.shift();
    if (!step) throw new Error('roteiro esgotado');
    const out = step(req);
    if (out instanceof Error) throw out;
    return out;
  }
}

let seq = 0;
const response = (content: unknown[], stop_reason: string): LlmResponse =>
  ({
    id: `msg_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: 'modelo-roteirizado',
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }) as unknown as LlmResponse;

const thinking = (sig: string) => ({ type: 'thinking', thinking: '', signature: sig });
const tool =
  (
    name: string,
    input: Record<string, unknown> | ((req: LlmRequest) => Record<string, unknown>),
    sig?: string,
  ): Step =>
  (req) =>
    response(
      [
        ...(sig ? [thinking(sig)] : []),
        {
          type: 'tool_use',
          id: `toolu_${++seq}`,
          name,
          input: typeof input === 'function' ? input(req) : input,
        },
      ],
      'tool_use',
    );
const say =
  (text: string | ((req: LlmRequest) => string)): Step =>
  (req) =>
    response([{ type: 'text', text: typeof text === 'function' ? text(req) : text }], 'end_turn');

/** Todos os resultados de ferramenta vistos na requisição, em ordem. */
function toolResults(req: LlmRequest): { content: Record<string, unknown>; isError: boolean }[] {
  const out: { content: Record<string, unknown>; isError: boolean }[] = [];
  for (const m of req.messages) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        out.push({ content: JSON.parse(String(b.content)), isError: Boolean(b.is_error) });
      }
    }
  }
  return out;
}
const lastResult = (req: LlmRequest) => toolResults(req).at(-1)!;
const firstOption = (req: LlmRequest) =>
  (lastResult(req).content.opcoes as { data: string; hora: string; profissionais: string[] }[])[0]!;
const lastMessage = (req: LlmRequest): LlmMessage => req.messages.at(-1)!;

let ctx: TestContext;
let owner: TestClient;
let shop: ShopFixture;
let llm: ScriptedLlm;
let ai: ServiceContext;

async function configureReceptionist() {
  const personas = json(await owner.get(`${shop.base}/voice-studio`)).personas as {
    id: string;
    key: string;
  }[];
  const res = await owner.put(`${shop.base}/voice-studio/config`, {
    personaId: personas.find((p) => p.key === 'classico')!.id,
    receptionistName: null,
    formality: 'SEMIFORMAL',
    slangLevel: 'LOW',
    emojisEnabled: false,
    enthusiasm: 3,
    relaxation: 3,
    useCustomerName: 'GREETING',
    signatureExpressions: [],
    vocabularyPrefer: [],
    vocabularyAvoid: [],
  });
  expect(res.statusCode).toBe(200);
}

const PHONE_CARLOS = '+5511999990001';

beforeAll(async () => {
  ctx = await createTestContext();
  owner = (await signup(ctx)).client;
  shop = await setupShop(owner);
  const tenant = (await loadTenantSettings(ctx.app.deps.db, shop.tenantId))!;
  ai = aiContext({ deps: ctx.app.deps, tenant, actor: { userId: null, role: null, type: 'USER' }, meta: {} });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(() => {
  llm = new ScriptedLlm();
  ctx.app.deps.llm = null;
});

describe('recepcionista sem integração', () => {
  it('informa que o modelo não está integrado e o simulador recusa com 503', async () => {
    const status = json(await owner.get(`${shop.base}/receptionist/status`));
    expect(status).toEqual({
      llm: { configured: false, provider: null, model: null },
      receptionistConfigured: false,
    });
    const res = await owner.post(`${shop.base}/simulator/conversations`, { channel: 'WHATSAPP' });
    expect(res.statusCode).toBe(503);
    expect(json(res).error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('exige a recepcionista configurada no Voice Studio', async () => {
    ctx.app.deps.llm = llm;
    const res = await owner.post(`${shop.base}/simulator/conversations`, { channel: 'WHATSAPP' });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('RECEPTIONIST_NOT_CONFIGURED');
  });

  it('mensagem de canal sem IA nunca se perde: a conversa já nasce com a equipe', async () => {
    const id = await openChannelConversation(ai, { channel: 'WHATSAPP', contactPhone: '+5511999990099' });
    const turn = await handleCustomerMessage(ai, id, 'Oi, tem horário hoje?');
    expect(turn).toMatchObject({ reply: null, status: 'HANDOFF' });
    const msgs = await ctx.admin.db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, id));
    expect(msgs.map((m) => m.role)).toEqual(['CUSTOMER']);
  });
});

describe('atendimento com ferramentas sobre a agenda real', () => {
  let conversationId: string;
  let flowRequests: LlmRequest[] = [];

  beforeAll(async () => {
    await configureReceptionist();
  });

  it('agenda de ponta a ponta: consulta, reserva temporária, "sim" do cliente, confirmação', async () => {
    ctx.app.deps.llm = llm;
    conversationId = await openChannelConversation(ai, {
      channel: 'WHATSAPP',
      contactPhone: PHONE_CARLOS,
      contactName: 'Carlos',
    });
    const [conv] = await ctx.admin.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(conv).toMatchObject({ status: 'OPEN', isSimulation: false });
    expect(conv!.systemPrompt).toContain('REGRAS INVIOLÁVEIS');
    expect(conv!.systemPrompt).toContain('Corte');

    // rodada 1: interpreta a data, consulta a agenda e oferece um horário devolvido por ela
    llm.push(
      tool('interpretar_data', { expressao: 'amanhã à tarde' }, 'assinatura-1'),
      tool('consultar_horarios', {
        servicos: ['corte'],
        data_inicial: '2026-11-03',
        hora_de: '12:00',
        hora_ate: '18:00',
      }),
      say((req) => {
        const o = firstOption(req);
        return `Amanhã tenho às ${o.hora} com ${o.profissionais[0]}. Qual é o seu nome para eu reservar?`;
      }),
    );
    const t1 = await handleCustomerMessage(ai, conversationId, 'Oi! Quero cortar o cabelo amanhã à tarde');
    expect(t1.status).toBe('OPEN');
    expect(t1.verification?.rejected).toEqual([]);
    expect(t1.reply).toMatch(/^Amanhã tenho às \d{2}:\d{2} com /);
    // a primeira requisição traz o "agora" como mensagem de sistema da plataforma
    const sys = lastMessage(llm.requests[0]!);
    expect(sys.role).toBe('system');
    expect(JSON.stringify(sys.content)).toContain('02/11/2026');
    const offered = firstOption(llm.requests[2]!);

    // rodada 2: reserva temporária; a confirmação na MESMA rodada é recusada pela ferramenta
    llm.push(
      tool('reservar_horario', {
        servicos: ['Corte'],
        data: offered.data,
        hora: offered.hora,
        nome_cliente: 'Carlos',
      }),
      tool('confirmar_reserva', (req) => ({ reserva_id: lastResult(req).content.reserva_id as string })),
      say((req) => {
        const r = toolResults(req).at(-2)!.content;
        return `Reservei o horário de amanhã às ${String(r.hora)} com ${String(r.profissional)}, no valor de ${String(r.valor_total)}. Posso confirmar?`;
      }),
    );
    const t2 = await handleCustomerMessage(ai, conversationId, 'Sou o Carlos, pode ser esse');
    expect(t2.reply).toContain('Posso confirmar?');
    expect(t2.verification?.rejected).toEqual([]);
    const confirmAttempt = lastResult(llm.requests.at(-1)!);
    expect(confirmAttempt.isError).toBe(true);
    expect(String(confirmAttempt.content.erro)).toContain('aguarde a resposta');

    const [held] = await ctx.admin.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, shop.tenantId), eq(appointments.status, 'HELD')));
    expect(held).toBeDefined();
    expect(held!.source).toBe('AI_WHATSAPP');
    expect(held!.holdExpiresAt).not.toBeNull();
    const [carlos] = await ctx.admin.db.select().from(customers).where(eq(customers.phone, PHONE_CARLOS));
    expect(carlos).toMatchObject({ name: 'Carlos', source: 'WHATSAPP' });

    // rodada 3: com o "sim" do cliente, confirma no banco e só então diz que está confirmado
    llm.push(
      tool('confirmar_reserva', (req) => {
        const r = toolResults(req).find((x) => x.content.reserva_id);
        return { reserva_id: r!.content.reserva_id as string };
      }),
      say(
        (req) =>
          `Pronto, Carlos! Seu horário está confirmado para amanhã às ${String(lastResult(req).content.hora)}.`,
      ),
    );
    const t3 = await handleCustomerMessage(ai, conversationId, 'Sim, confirma');
    expect(t3.reply).toContain('confirmado');
    expect(t3.verification?.rejected).toEqual([]);
    const [confirmed] = await ctx.admin.db.select().from(appointments).where(eq(appointments.id, held!.id));
    expect(confirmed!.status).toBe('CONFIRMED');
    expect(confirmed!.holdExpiresAt).toBeNull();
    const [after] = await ctx.admin.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(after!.customerId).toBe(carlos!.id);
    flowRequests = llm.requests;
  });

  it('histórico enviado ao modelo é somente-acréscimo e preserva o raciocínio', async () => {
    const turns = await ctx.admin.db
      .select()
      .from(conversationLlmTurns)
      .where(eq(conversationLlmTurns.conversationId, conversationId))
      .orderBy(asc(conversationLlmTurns.seq));
    expect(turns.map((t) => t.seq)).toEqual([1, 2, 3]);
    const stored = turns.flatMap((t) => t.messages as LlmMessage[]);
    // a primeira requisição da 3ª rodada começa exatamente com o histórico das rodadas anteriores
    const firstOfTurn3 = flowRequests.find((r) =>
      r.messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('Sim, confirma')),
    )!;
    const before = turns.slice(0, 2).flatMap((t) => t.messages as LlmMessage[]);
    expect(firstOfTurn3.messages.slice(0, before.length)).toEqual(before);
    // o bloco de raciocínio da 1ª rodada voltou intacto (assinatura preservada)
    expect(JSON.stringify(stored)).toContain('assinatura-1');
    // e cada pedido de ferramenta tem seu resultado na mensagem seguinte
    for (let i = 0; i < stored.length; i++) {
      const m = stored[i]!;
      if (
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use')
      ) {
        expect(JSON.stringify(stored[i + 1])).toContain('tool_result');
      }
    }
  });

  it('verificador bloqueia preço inventado e entrega a versão corrigida', async () => {
    ctx.app.deps.llm = llm;
    llm.push(say('O corte custa R$ 40,00.'), (req) => {
      const tail = lastMessage(req);
      expect(tail.role).toBe('system');
      expect(JSON.stringify(tail.content)).toContain('VERIFICAÇÃO DA PLATAFORMA');
      expect(JSON.stringify(tail.content)).toContain('R$ 40,00');
      return say('O corte custa R$ 45,00 e leva cerca de 30 minutos.')(req);
    });
    const t = await handleCustomerMessage(ai, conversationId, 'Quanto custa o corte?');
    expect(t.reply).toBe('O corte custa R$ 45,00 e leva cerca de 30 minutos.');
    expect(t.verification?.rejected).toHaveLength(1);
    expect(t.verification?.rejected[0]!.violations[0]!.code).toBe('UNVERIFIED_PRICE');
    // a resposta reprovada nunca entra no histórico; a correção entra junto com a aprovada
    const [last] = await ctx.admin.db
      .select()
      .from(conversationLlmTurns)
      .where(eq(conversationLlmTurns.conversationId, conversationId))
      .orderBy(asc(conversationLlmTurns.seq))
      .then((rows) => rows.slice(-1));
    const text = JSON.stringify(last!.messages);
    expect(text).not.toContain('R$ 40,00.');
    expect(text).toContain('VERIFICAÇÃO DA PLATAFORMA');
  });

  it('erros repetidos viram resposta segura e transferência para a equipe', async () => {
    ctx.app.deps.llm = llm;
    const id = await openChannelConversation(ai, { channel: 'WHATSAPP', contactPhone: '+5511999990002' });
    llm.push(say('Está agendado!'), say('Agendado para você!'), say('Já marquei, pode vir.'));
    const t = await handleCustomerMessage(ai, id, 'Quero marcar um corte');
    expect(t.reply).toBe(SAFE_REPLIES.VERIFICATION);
    expect(t.status).toBe('HANDOFF');
    expect(t.verification?.rejected).toHaveLength(3);
    // depois da transferência, a recepcionista não responde mais (o modelo nem é chamado)
    const calls = llm.requests.length;
    const t2 = await handleCustomerMessage(ai, id, 'Alô?');
    expect(t2).toMatchObject({ reply: null, status: 'HANDOFF' });
    expect(llm.requests.length).toBe(calls);
  });

  it('provedor indisponível ou recusa geram resposta segura (nada inventado)', async () => {
    ctx.app.deps.llm = llm;
    const a = await openChannelConversation(ai, { channel: 'WHATSAPP', contactPhone: '+5511999990003' });
    llm.push(() => new LlmUnavailableError('fora do ar', 'TRANSIENT'));
    expect((await handleCustomerMessage(ai, a, 'Oi')).reply).toBe(SAFE_REPLIES.UNAVAILABLE);

    const b = await openChannelConversation(ai, { channel: 'WHATSAPP', contactPhone: '+5511999990004' });
    llm.push(() => response([], 'refusal'));
    const t = await handleCustomerMessage(ai, b, 'Oi');
    expect(t).toMatchObject({ reply: SAFE_REPLIES.REFUSAL, status: 'HANDOFF' });
  });

  it('cliente só acessa os próprios agendamentos; entradas inválidas viram erro para o modelo', async () => {
    ctx.app.deps.llm = llm;
    const [carlosAppt] = await ctx.admin.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, shop.tenantId), eq(appointments.status, 'CONFIRMED')));
    const other = await openChannelConversation(ai, { channel: 'WHATSAPP', contactPhone: '+5511999990005' });
    llm.push(
      tool('cancelar_agendamento', { agendamento_id: carlosAppt!.id }),
      tool('consultar_horarios', { servicos: ['Corte'], data_inicial: '03/11/2026' }),
      tool('consultar_horarios', { servicos: ['Massagem'], data_inicial: '2026-11-03' }),
      say('Não encontrei agendamentos no seu nome. Posso ajudar com outra coisa?'),
    );
    await handleCustomerMessage(ai, other, 'Cancela o horário de amanhã');
    const results = toolResults(llm.requests.at(-1)!);
    expect(results[0]).toMatchObject({ isError: true });
    expect(String(results[0]!.content.erro)).toContain('não encontrado');
    expect(results[1]!.content.erro).toBe('Parâmetros inválidos.');
    expect(String(results[2]!.content.erro)).toContain('não encontrado no catálogo');
    // apenas serviços do catálogo agendáveis pela IA (ordem de exibição do catálogo)
    expect(results[2]!.content.opcoes_validas).toEqual(['Barba', 'Coloração', 'Corte']);
    const [still] = await ctx.admin.db.select().from(appointments).where(eq(appointments.id, carlosAppt!.id));
    expect(still!.status).toBe('CONFIRMED');
  });

  it('remarcação e cancelamento pelo próprio cliente usam a agenda real', async () => {
    ctx.app.deps.llm = llm;
    const [appt] = await ctx.admin.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, shop.tenantId), eq(appointments.status, 'CONFIRMED')));
    llm.push(
      tool('meus_agendamentos', {}),
      tool('consultar_horarios', {
        servicos: ['Corte'],
        data_inicial: '2026-11-04',
        hora_de: '09:00',
        hora_ate: '12:00',
      }),
      tool('remarcar_agendamento', (req) => {
        const o = firstOption(req);
        return { agendamento_id: appt!.id, data: o.data, hora: o.hora };
      }),
      say((req) => `Remarquei para quarta às ${String(lastResult(req).content.hora)}.`),
    );
    const t = await handleCustomerMessage(ai, conversationId, 'Preciso trocar para quarta de manhã');
    expect(t.verification?.rejected).toEqual([]);
    const rescheduled = await ctx.admin.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.rescheduledFromId, appt!.id)));
    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0]!.status).toBe('CONFIRMED');

    llm.push(
      tool('cancelar_agendamento', { agendamento_id: rescheduled[0]!.id, motivo: 'viagem' }),
      say('Seu agendamento foi cancelado. Quando quiser remarcar, é só chamar.'),
    );
    await handleCustomerMessage(ai, conversationId, 'Na verdade, cancela, vou viajar');
    const [cancelled] = await ctx.admin.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, rescheduled[0]!.id));
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledBy: 'CUSTOMER' });
  });
});

describe('reservas temporárias e configuração do provedor', () => {
  it('reserva vencida nunca é confirmada (outro cliente pode ter ocupado o horário)', async () => {
    ctx.app.deps.llm = llm;
    const id = await openChannelConversation(ai, {
      channel: 'WHATSAPP',
      contactPhone: '+5511999990006',
      contactName: 'Bia',
    });
    llm.push(
      tool('consultar_horarios', { servicos: ['Barba'], data_inicial: '2026-11-05' }),
      tool('reservar_horario', (req) => {
        const o = firstOption(req);
        return { servicos: ['Barba'], data: o.data, hora: o.hora, nome_cliente: 'Bia' };
      }),
      say('Reservei esse horário por 10 minutos. Posso confirmar?'),
    );
    await handleCustomerMessage(ai, id, 'Barba na quinta');
    ctx.setNow(new Date(MONDAY_10AM.getTime() + 11 * 60_000));
    try {
      llm.push(
        tool('confirmar_reserva', (req) => ({
          reserva_id: toolResults(req).find((x) => x.content.reserva_id)!.content.reserva_id as string,
        })),
        say('A reserva expirou. Quer que eu consulte os horários de novo?'),
      );
      await handleCustomerMessage(ai, id, 'Sim');
      const r = lastResult(llm.requests.at(-1)!);
      expect(r).toMatchObject({ isError: true, content: { codigo: 'HOLD_EXPIRED' } });
    } finally {
      ctx.setNow(MONDAY_10AM);
    }
  });

  it('o adaptador do provedor só existe com chave explícita no servidor', () => {
    const base = ctx.app.deps.config;
    expect(createLlmClient({ ...base, ANTHROPIC_API_KEY: '' })).toBeNull();
    expect(createLlmClient({ ...base, ANTHROPIC_API_KEY: undefined })).toBeNull();
    const client = createLlmClient({ ...base, ANTHROPIC_API_KEY: 'sk-teste-nao-usada' })!;
    expect(client).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
  });
});

describe('simulador do Voice Studio (HTTP)', () => {
  it('consulta a agenda real, mas não grava reservas', async () => {
    ctx.app.deps.llm = llm;
    const before = await ctx.admin.db
      .select()
      .from(appointments)
      .where(eq(appointments.tenantId, shop.tenantId));
    const start = await owner.post(`${shop.base}/simulator/conversations`, { channel: 'PHONE' });
    expect(start.statusCode).toBe(201);
    const conv = json(start);
    expect(conv).toMatchObject({
      channel: 'PHONE',
      isSimulation: true,
      status: 'OPEN',
      model: 'modelo-roteirizado',
    });

    llm.push(
      tool('consultar_horarios', { servicos: ['Barba'], data_inicial: '2026-11-03' }),
      tool('reservar_horario', (req) => {
        const o = firstOption(req);
        return { servicos: ['Barba'], data: o.data, hora: o.hora, nome_cliente: 'Teste' };
      }),
      say((req) => `Reservei amanhã às ${String(lastResult(req).content.hora)}. Posso confirmar?`),
    );
    const t1 = await owner.post(`${shop.base}/simulator/conversations/${conv.id}/messages`, {
      text: 'Quero fazer a barba amanhã',
    });
    expect(t1.statusCode).toBe(200);
    const body1 = json(t1);
    expect(body1.reply).toMatch(/Reservei amanhã às/);
    // ligação: versão falada com horário por extenso
    expect(body1.speech).not.toMatch(/\d/);
    expect(body1.conversation.messages.filter((m: { role: string }) => m.role === 'TOOL')).toHaveLength(2);

    llm.push(
      tool('confirmar_reserva', (req) => ({
        reserva_id: toolResults(req).find((x) => x.content.reserva_id)!.content.reserva_id as string,
      })),
      say('Pronto, está confirmado!'),
    );
    const t2 = json(
      await owner.post(`${shop.base}/simulator/conversations/${conv.id}/messages`, { text: 'Sim' }),
    );
    expect(t2.reply).toBe('Pronto, está confirmado!');
    expect(lastResult(llm.requests.at(-1)!).content).toMatchObject({ simulacao: true, confirmado: true });

    const after = await ctx.admin.db
      .select()
      .from(appointments)
      .where(eq(appointments.tenantId, shop.tenantId));
    expect(after.length).toBe(before.length);
  });

  it('lista conversas, permite assumir, devolver e encerrar; recusa mensagem de cliente real pelo simulador', async () => {
    ctx.app.deps.llm = llm;
    const real = json(await owner.get(`${shop.base}/conversations`));
    expect(real.every((c: { isSimulation: boolean }) => !c.isSimulation)).toBe(true);
    const carlos = real.find((c: { contactPhone: string }) => c.contactPhone === PHONE_CARLOS);
    expect(carlos.customer.name).toBe('Carlos');
    const sims = json(await owner.get(`${shop.base}/conversations?simulations=true`));
    expect(sims.length).toBeGreaterThan(0);

    const blocked = await owner.post(`${shop.base}/simulator/conversations/${carlos.id}/messages`, {
      text: 'Oi',
    });
    expect(blocked.statusCode).toBe(403);

    const taken = json(await owner.post(`${shop.base}/conversations/${carlos.id}/take-over`));
    expect(taken.status).toBe('HANDOFF');
    const back = json(await owner.post(`${shop.base}/conversations/${carlos.id}/return-to-ai`));
    expect(back).toMatchObject({ status: 'OPEN', handoffReason: null });
    const closed = json(await owner.post(`${shop.base}/conversations/${carlos.id}/close`));
    expect(closed.status).toBe('CLOSED');
    const detail = json(await owner.get(`${shop.base}/conversations/${carlos.id}`));
    expect(detail.messages.some((m: { role: string }) => m.role === 'TOOL')).toBe(true);
  });

  it('outro estabelecimento não enxerga as conversas', async () => {
    const intruder = (await signup(ctx, 'Intruso')).client;
    const other = await setupShop(intruder);
    const list = json(await intruder.get(`${other.base}/conversations`));
    expect(list).toEqual([]);
    const res = await intruder.get(`${shop.base}/conversations`);
    expect(res.statusCode).toBe(404);
  });

  it('anonimizar o cliente apaga o conteúdo das conversas e o histórico do modelo', async () => {
    const [carlos] = await ctx.admin.db.select().from(customers).where(eq(customers.phone, PHONE_CARLOS));
    const res = await owner.post(`${shop.base}/customers/${carlos!.id}/anonymize`);
    expect(res.statusCode).toBe(204);
    const convs = await ctx.admin.db
      .select()
      .from(conversations)
      .where(eq(conversations.customerId, carlos!.id));
    expect(convs.length).toBeGreaterThan(0);
    for (const c of convs) {
      expect(c.contactPhone).toBeNull();
      const msgs = await ctx.admin.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, c.id));
      expect(msgs.every((m) => m.content === '[conteúdo removido — LGPD]' && m.toolOutput === null)).toBe(
        true,
      );
      const turns = await ctx.admin.db
        .select()
        .from(conversationLlmTurns)
        .where(eq(conversationLlmTurns.conversationId, c.id));
      expect(turns).toHaveLength(0);
    }
  });
});
