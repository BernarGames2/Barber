import {
  WEEKDAY_NAMES_PT,
  addDays,
  describeTemporalResolution,
  formatBRL,
  instantToLocal,
  localToInstant,
  normalizePt,
  resolveTemporalExpression,
  uuidv7,
} from '@barber-voice/core';
import {
  type Tx,
  appointments,
  conversations,
  customers,
  professionals,
  services,
  withTenant,
} from '@barber-voice/db';
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { ServiceContext } from '../../context';
import { AppError } from '../../lib/errors';
import { getAvailability } from '../appointments/availability';
import {
  cancelAppointment,
  createAppointment,
  rescheduleAppointment,
  updateAppointmentStatus,
} from '../appointments/booking';
import { loadAppointmentDtos } from '../appointments/queries';
import type { LlmTool } from './llm';

type ConversationRow = typeof conversations.$inferSelect;

/** Reserva temporária criada nesta conversa (real ou simulada). */
export interface HoldRecord {
  id: string;
  simulated: boolean;
  /** Rodada em que foi criada: a confirmação exige uma resposta do cliente DEPOIS dela. */
  turnSeq: number;
  date: string;
  time: string;
}

/** Evidências que cada ferramenta devolve para o verificador de afirmações. */
export interface ToolEvidence {
  slots?: { date: string; time: string }[];
  quotedPricesCents?: number[];
  hold?: HoldRecord;
  booked?: boolean;
  cancelled?: boolean;
  rescheduled?: boolean;
  /** O cliente já tinha agendamento confirmado (consulta de agendamentos). */
  hasConfirmedAppointment?: boolean;
}

export interface ToolOutcome {
  /** Conteúdo entregue ao modelo (JSON). */
  result: Record<string, unknown>;
  isError: boolean;
  evidence?: ToolEvidence;
  effects?: { handoffReason?: string; customerId?: string };
}

export interface ToolContext {
  /** Contexto com ator "AI": auditoria registra a recepcionista como autora. */
  svc: ServiceContext;
  conversation: ConversationRow;
  turnSeq: number;
  holds: readonly HoldRecord[];
  /** Id da chamada da ferramenta (idempotência das gravações). */
  toolUseId: string;
}

const HOLD_TTL_SEC = 10 * 60;
const MAX_OPTIONS = 8;
const PER_DAY = 4;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:mm (24h)');
const names = z.array(z.string().trim().min(1).max(80)).min(1).max(5);

const SCHEMAS = {
  interpretar_data: z.object({ expressao: z.string().trim().min(1).max(200) }),
  consultar_horarios: z.object({
    servicos: names,
    data_inicial: dateStr,
    data_final: dateStr.optional(),
    hora_de: timeStr.optional(),
    hora_ate: timeStr.optional(),
    profissional: z.string().trim().min(1).max(80).optional(),
  }),
  reservar_horario: z.object({
    servicos: names,
    data: dateStr,
    hora: timeStr,
    profissional: z.string().trim().min(1).max(80).optional(),
    nome_cliente: z.string().trim().min(2).max(80).optional(),
  }),
  confirmar_reserva: z.object({ reserva_id: z.string().min(1).max(80) }),
  meus_agendamentos: z.object({}),
  cancelar_agendamento: z.object({
    agendamento_id: z.string().uuid(),
    motivo: z.string().trim().max(200).optional(),
  }),
  remarcar_agendamento: z.object({
    agendamento_id: z.string().uuid(),
    data: dateStr,
    hora: timeStr,
    profissional: z.string().trim().min(1).max(80).optional(),
  }),
  transferir_para_humano: z.object({ motivo: z.string().trim().min(2).max(200) }),
} as const;

export type ToolName = keyof typeof SCHEMAS;

const str = (description: string) => ({ type: 'string', description }) as const;
const servicosProp = {
  type: 'array',
  items: { type: 'string' },
  description: 'Nomes dos serviços exatamente como aparecem nos DADOS DO ESTABELECIMENTO.',
} as const;

/** Definições entregues ao modelo. A ordem e o conteúdo são fixos (cache e histórico estáveis). */
export const TOOL_DEFINITIONS: LlmTool[] = [
  {
    name: 'interpretar_data',
    description:
      'Interpreta uma expressão de data/horário dita pelo cliente ("sexta depois do almoço", "amanhã cedo", "dia 15 às 3") e devolve datas (AAAA-MM-DD), faixa de horário e ambiguidades a confirmar. Também informa a data de hoje. Use antes de consultar horários sempre que o cliente falar de datas.',
    input_schema: {
      type: 'object',
      properties: { expressao: str('Trecho da fala do cliente sobre data/horário.') },
      required: ['expressao'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_horarios',
    description:
      'Consulta a agenda REAL e devolve horários livres para os serviços pedidos. Única fonte válida de disponibilidade: nunca ofereça um horário que não veio desta ferramenta.',
    input_schema: {
      type: 'object',
      properties: {
        servicos: servicosProp,
        data_inicial: str('AAAA-MM-DD'),
        data_final: str('AAAA-MM-DD (opcional; no máximo 14 dias depois da inicial).'),
        hora_de: str('HH:mm — início da faixa desejada (opcional).'),
        hora_ate: str('HH:mm — fim da faixa desejada (opcional).'),
        profissional: str('Nome do profissional, se o cliente tiver preferência (opcional).'),
      },
      required: ['servicos', 'data_inicial'],
      additionalProperties: false,
    },
  },
  {
    name: 'reservar_horario',
    description:
      'Segura temporariamente (10 minutos) um horário devolvido por consultar_horarios. Depois, apresente o resumo ao cliente e só chame confirmar_reserva quando ele responder que confirma.',
    input_schema: {
      type: 'object',
      properties: {
        servicos: servicosProp,
        data: str('AAAA-MM-DD'),
        hora: str('HH:mm'),
        profissional: str('Nome do profissional (opcional; sem ele, qualquer profissional livre).'),
        nome_cliente: str('Nome do cliente, se ainda não for cliente cadastrado.'),
      },
      required: ['servicos', 'data', 'hora'],
      additionalProperties: false,
    },
  },
  {
    name: 'confirmar_reserva',
    description:
      'Confirma a reserva temporária depois que o cliente disse que confirma o resumo apresentado. Só depois do sucesso desta ferramenta você pode dizer que está agendado.',
    input_schema: {
      type: 'object',
      properties: { reserva_id: str('Id devolvido por reservar_horario.') },
      required: ['reserva_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'meus_agendamentos',
    description: 'Lista os próximos agendamentos do cliente desta conversa (identificado pelo telefone).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancelar_agendamento',
    description:
      'Cancela um agendamento do cliente desta conversa, respeitando o prazo do estabelecimento. Confirme com o cliente antes de cancelar.',
    input_schema: {
      type: 'object',
      properties: {
        agendamento_id: str('Id devolvido por meus_agendamentos.'),
        motivo: str('Motivo informado pelo cliente (opcional).'),
      },
      required: ['agendamento_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'remarcar_agendamento',
    description:
      'Remarca um agendamento do cliente para um horário devolvido por consultar_horarios. A troca é atômica: se o novo horário não estiver livre, o original é mantido.',
    input_schema: {
      type: 'object',
      properties: {
        agendamento_id: str('Id devolvido por meus_agendamentos.'),
        data: str('AAAA-MM-DD'),
        hora: str('HH:mm'),
        profissional: str('Nome do profissional (opcional).'),
      },
      required: ['agendamento_id', 'data', 'hora'],
      additionalProperties: false,
    },
  },
  {
    name: 'transferir_para_humano',
    description:
      'Transfere o atendimento para a equipe (pedido do cliente, reclamação, assunto fora do escopo, regra que impede ajudar). Depois desta ferramenta, avise o cliente e encerre sua participação.',
    input_schema: {
      type: 'object',
      properties: { motivo: str('Motivo resumido da transferência.') },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

const fail = (message: string, extra: Record<string, unknown> = {}): ToolOutcome => ({
  result: { erro: message, ...extra },
  isError: true,
});

const fmtDate = (date: string) => {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
};

function localParts(iso: string, tz: string) {
  const p = instantToLocal(Date.parse(iso), tz);
  return { date: p.date, time: p.time, weekday: WEEKDAY_NAMES_PT[p.weekday] };
}

type Resolution<T> = ({ ok: true } & T) | { ok: false; error: string; available: string[] };

/** Resolve nomes falados para serviços do catálogo (sem inventar: precisa casar com um cadastro). */
async function resolveServiceNames(tx: Tx, requested: string[]): Promise<Resolution<{ ids: string[] }>> {
  const rows = await tx
    .select()
    .from(services)
    .where(and(eq(services.active, true), isNull(services.archivedAt)))
    .orderBy(asc(services.sortOrder), asc(services.name));
  const ids: string[] = [];
  for (const raw of requested) {
    const n = normalizePt(raw);
    const exact = rows.filter((r) => normalizePt(r.name) === n);
    const partial = exact.length
      ? exact
      : rows.filter((r) => normalizePt(r.name).includes(n) || n.includes(normalizePt(r.name)));
    if (partial.length !== 1) {
      return {
        ok: false,
        error: partial.length
          ? `"${raw}" corresponde a mais de um serviço: ${partial.map((r) => r.name).join(', ')}. Pergunte qual.`
          : `Serviço "${raw}" não encontrado no catálogo. Não ofereça serviços fora da lista.`,
        available: rows.filter((r) => r.bookableByAi).map((r) => r.name),
      };
    }
    const svc = partial[0]!;
    if (!svc.bookableByAi) {
      return {
        ok: false,
        error: `"${svc.name}" só pode ser agendado pela equipe. Ofereça a transferência.`,
        available: [],
      };
    }
    ids.push(svc.id);
  }
  return { ok: true, ids: [...new Set(ids)] };
}

async function resolveProfessionalName(
  tx: Tx,
  raw: string,
): Promise<Resolution<{ id: string; name: string }>> {
  const rows = await tx
    .select({ id: professionals.id, name: professionals.name })
    .from(professionals)
    .where(and(eq(professionals.active, true), isNull(professionals.archivedAt)));
  const n = normalizePt(raw);
  const exact = rows.filter((r) => normalizePt(r.name) === n);
  const list = exact.length
    ? exact
    : rows.filter((r) => normalizePt(r.name).split(' ').includes(n) || normalizePt(r.name).startsWith(n));
  if (list.length !== 1) {
    return {
      ok: false,
      error: list.length
        ? `Há mais de um profissional com esse nome: ${list.map((r) => r.name).join(', ')}.`
        : `Profissional "${raw}" não encontrado.`,
      available: rows.map((r) => r.name),
    };
  }
  return { ok: true, id: list[0]!.id, name: list[0]!.name };
}

/** Cliente desta conversa: já vinculado ou encontrado pelo telefone do canal (nunca pelo que o modelo diz). */
async function conversationCustomer(tx: Tx, conv: ConversationRow) {
  if (conv.customerId) {
    const [c] = await tx.select().from(customers).where(eq(customers.id, conv.customerId)).limit(1);
    if (c && !c.anonymizedAt) return c;
  }
  if (!conv.contactPhone) return null;
  const [c] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.phone, conv.contactPhone), isNull(customers.anonymizedAt)))
    .limit(1);
  return c ?? null;
}

function toolError(err: unknown): ToolOutcome {
  if (err instanceof AppError) {
    return fail(err.message, { codigo: err.code });
  }
  throw err;
}

function nameMap(tx: Tx, ids: string[]) {
  return tx
    .select({ id: professionals.id, name: professionals.name })
    .from(professionals)
    .where(inArray(professionals.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))
    .then((rows) => new Map(rows.map((r) => [r.id, r.name])));
}

async function interpretarData(ctx: ToolContext, input: z.infer<(typeof SCHEMAS)['interpretar_data']>) {
  const tz = ctx.svc.tenant.timezone;
  const now = ctx.svc.deps.clock().getTime();
  const r = resolveTemporalExpression(input.expressao, { now, timezone: tz });
  const today = instantToLocal(now, tz);
  return {
    result: {
      hoje: `${WEEKDAY_NAMES_PT[today.weekday]}, ${fmtDate(today.date)} (${today.date}), ${today.time}`,
      reconhecido: r.recognized,
      datas: r.dates,
      outras_datas_possiveis: r.dateCandidates,
      horario: r.time,
      horarios_possiveis: r.timeCandidates,
      primeiro_disponivel: r.firstAvailable,
      data_no_passado: r.pastDate,
      ambiguidades: r.ambiguities,
      resumo: describeTemporalResolution(r),
    },
    isError: false,
  } satisfies ToolOutcome;
}

async function consultarHorarios(
  ctx: ToolContext,
  input: z.infer<(typeof SCHEMAS)['consultar_horarios']>,
): Promise<ToolOutcome> {
  const tz = ctx.svc.tenant.timezone;
  const resolved = await withTenant(ctx.svc.deps.db, ctx.svc.tenant.id, async (tx) => {
    const svc = await resolveServiceNames(tx, input.servicos);
    if (!svc.ok) return svc;
    const pro = input.profissional ? await resolveProfessionalName(tx, input.profissional) : null;
    if (pro && !pro.ok) return pro;
    const customer = await conversationCustomer(tx, ctx.conversation);
    return {
      ok: true as const,
      serviceIds: svc.ids,
      professionalId: pro?.ok ? pro.id : undefined,
      preferredProfessionalId: customer?.preferredProfessionalId ?? null,
    };
  });
  if (!resolved.ok) return fail(resolved.error, { opcoes_validas: resolved.available });

  const to = input.data_final ?? input.data_inicial;
  if (to < input.data_inicial) return fail('data_final anterior à data_inicial.');
  if (addDays(input.data_inicial, 14) < to) return fail('Consulte no máximo 14 dias por vez.');

  try {
    const availability = await getAvailability(ctx.svc, {
      serviceIds: resolved.serviceIds,
      professionalId: resolved.professionalId,
      from: input.data_inicial,
      to,
      timeFrom: input.hora_de,
      timeTo: input.hora_ate,
      preferredProfessionalId: resolved.preferredProfessionalId,
      forAi: true,
    });
    const names = await withTenant(ctx.svc.deps.db, ctx.svc.tenant.id, (tx) =>
      nameMap(tx, [...new Set(availability.slots.flatMap((s) => s.professionalIds))]),
    );
    // distribui as opções pelo período (no máximo 4 por dia, 8 no total)
    const byDay = new Map<string, typeof availability.slots>();
    for (const s of availability.slots) {
      const d = localParts(s.start, tz).date;
      byDay.set(d, [...(byDay.get(d) ?? []), s]);
    }
    const options: { data: string; dia_semana: string; hora: string; profissionais: string[] }[] = [];
    for (const [, list] of byDay) {
      const step = Math.max(1, Math.floor(list.length / PER_DAY));
      for (let i = 0; i < list.length && options.length < MAX_OPTIONS; i += step) {
        const s = list[i]!;
        const p = localParts(s.start, tz);
        if (options.filter((o) => o.data === p.date).length >= PER_DAY) break;
        options.push({
          data: p.date,
          dia_semana: p.weekday,
          hora: p.time,
          profissionais: s.professionalIds.map((id) => names.get(id) ?? '').filter(Boolean),
        });
      }
      if (options.length >= MAX_OPTIONS) break;
    }
    return {
      result: {
        opcoes: options,
        total_de_horarios_livres: availability.slots.length,
        observacao: options.length
          ? 'Ofereça apenas estes horários. Para outro horário específico, consulte de novo com hora_de/hora_ate.'
          : 'Nenhum horário livre neste período. Ofereça outra data ou a lista de espera com a equipe.',
      },
      isError: false,
      evidence: { slots: options.map((o) => ({ date: o.data, time: o.hora })) },
    };
  } catch (err) {
    return toolError(err);
  }
}

async function reservarHorario(
  ctx: ToolContext,
  input: z.infer<(typeof SCHEMAS)['reservar_horario']>,
): Promise<ToolOutcome> {
  const { svc, conversation: conv } = ctx;
  const tz = svc.tenant.timezone;
  const prep = await withTenant(svc.deps.db, svc.tenant.id, async (tx) => {
    const s = await resolveServiceNames(tx, input.servicos);
    if (!s.ok) return s;
    const pro = input.profissional ? await resolveProfessionalName(tx, input.profissional) : null;
    if (pro && !pro.ok) return pro;
    const customer = await conversationCustomer(tx, conv);
    return { ok: true as const, serviceIds: s.ids, professionalId: pro?.ok ? pro.id : undefined, customer };
  });
  if (!prep.ok) return fail(prep.error, { opcoes_validas: prep.available });
  if (!prep.customer && !input.nome_cliente) {
    return fail('Pergunte o nome do cliente antes de reservar e envie em nome_cliente.');
  }
  const startsAt = new Date(localToInstant(input.data, input.hora, tz)).toISOString();

  if (conv.isSimulation) {
    // simulação: valida na agenda real, não grava nada
    try {
      const a = await getAvailability(svc, {
        serviceIds: prep.serviceIds,
        professionalId: prep.professionalId,
        from: input.data,
        to: input.data,
        forAi: true,
      });
      const slot = a.slots.find((s) => s.start === startsAt);
      if (!slot) return fail('Este horário não está livre. Consulte os horários novamente.');
      const names = await withTenant(svc.deps.db, svc.tenant.id, (tx) => nameMap(tx, slot.professionalIds));
      const proId = slot.professionalIds[0]!;
      const total = a.durationByProfessional[proId];
      const hold: HoldRecord = {
        id: `sim-${uuidv7()}`,
        simulated: true,
        turnSeq: ctx.turnSeq,
        date: input.data,
        time: input.hora,
      };
      return {
        result: {
          simulacao: true,
          reserva_id: hold.id,
          data: input.data,
          dia_semana: localParts(startsAt, tz).weekday,
          hora: input.hora,
          profissional: names.get(proId) ?? null,
          duracao_min: total ?? null,
          expira_em_minutos: HOLD_TTL_SEC / 60,
          proximo_passo: 'Apresente o resumo e pergunte se o cliente confirma.',
        },
        isError: false,
        evidence: { hold, slots: [{ date: input.data, time: input.hora }] },
      };
    } catch (err) {
      return toolError(err);
    }
  }

  // libera reservas temporárias anteriores desta conversa (o cliente mudou de ideia)
  for (const h of ctx.holds.filter((x) => !x.simulated)) {
    await cancelAppointment(svc, h.id, {
      cancelledBy: 'SYSTEM',
      reason: 'Nova reserva na mesma conversa',
    }).catch(() => undefined);
  }
  try {
    const source = conv.channel === 'PHONE' ? 'AI_PHONE' : 'AI_WHATSAPP';
    const { appointment } = await createAppointment(
      svc,
      {
        ...(prep.customer
          ? { customerId: prep.customer.id }
          : { newCustomer: { name: input.nome_cliente!, phone: conv.contactPhone } }),
        professionalId: prep.professionalId,
        serviceIds: prep.serviceIds,
        startsAt,
        source,
      },
      {
        forAi: true,
        customerFacing: true,
        holdTtlSec: HOLD_TTL_SEC,
        idempotencyKey: `conv:${conv.id}:${ctx.toolUseId}`,
      },
    );
    const p = localParts(appointment.startsAt, tz);
    const hold: HoldRecord = {
      id: appointment.id,
      simulated: false,
      turnSeq: ctx.turnSeq,
      date: p.date,
      time: p.time,
    };
    return {
      result: {
        reserva_id: appointment.id,
        data: p.date,
        dia_semana: p.weekday,
        hora: p.time,
        profissional: appointment.professional.name,
        servicos: appointment.items.map((i) => i.serviceName),
        duracao_min: appointment.totalDurationMin,
        valor_total:
          appointment.totalPriceCents === null
            ? 'sob consulta'
            : `${appointment.priceIsEstimate ? 'a partir de ' : ''}${formatBRL(appointment.totalPriceCents)}`,
        expira_em_minutos: HOLD_TTL_SEC / 60,
        proximo_passo: 'Apresente o resumo e pergunte se o cliente confirma.',
      },
      isError: false,
      evidence: {
        hold,
        slots: [{ date: p.date, time: p.time }],
        quotedPricesCents: appointment.totalPriceCents === null ? [] : [appointment.totalPriceCents],
      },
      effects: { customerId: appointment.customer.id },
    };
  } catch (err) {
    return toolError(err);
  }
}

async function confirmarReserva(
  ctx: ToolContext,
  input: z.infer<(typeof SCHEMAS)['confirmar_reserva']>,
): Promise<ToolOutcome> {
  const hold = ctx.holds.find((h) => h.id === input.reserva_id);
  if (!hold) return fail('Reserva não encontrada nesta conversa. Reserve o horário primeiro.');
  if (hold.turnSeq >= ctx.turnSeq) {
    return fail(
      'Apresente o resumo ao cliente e aguarde a resposta dele antes de confirmar. Nenhuma reserva é confirmada sem o "sim" do cliente.',
    );
  }
  if (hold.simulated) {
    return {
      result: { simulacao: true, confirmado: true, data: hold.date, hora: hold.time },
      isError: false,
      evidence: { booked: true, slots: [{ date: hold.date, time: hold.time }] },
    };
  }
  try {
    const a = await updateAppointmentStatus(ctx.svc, hold.id, 'CONFIRMED');
    const p = localParts(a.startsAt, ctx.svc.tenant.timezone);
    return {
      result: {
        confirmado: true,
        agendamento_id: a.id,
        data: p.date,
        dia_semana: p.weekday,
        hora: p.time,
        profissional: a.professional.name,
        servicos: a.items.map((i) => i.serviceName),
      },
      isError: false,
      evidence: { booked: true, slots: [{ date: p.date, time: p.time }] },
    };
  } catch (err) {
    return toolError(err);
  }
}

async function upcomingOfCustomer(ctx: ToolContext) {
  const { svc, conversation: conv } = ctx;
  return withTenant(svc.deps.db, svc.tenant.id, async (tx) => {
    const customer = await conversationCustomer(tx, conv);
    if (!customer) return { customer: null, list: [] };
    const now = svc.deps.clock();
    const rows = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.customerId, customer.id),
          inArray(appointments.status, ['PENDING', 'CONFIRMED']),
          gte(appointments.startsAt, now),
          lt(appointments.startsAt, new Date(now.getTime() + 120 * 86_400_000)),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(10);
    return {
      customer,
      list: await loadAppointmentDtos(
        tx,
        rows.map((r) => r.id),
      ),
    };
  });
}

async function meusAgendamentos(ctx: ToolContext): Promise<ToolOutcome> {
  const tz = ctx.svc.tenant.timezone;
  if (!ctx.conversation.contactPhone && !ctx.conversation.customerId) {
    return fail('Não há telefone do cliente nesta conversa para localizar agendamentos.');
  }
  const { customer, list } = await upcomingOfCustomer(ctx);
  if (!customer)
    return { result: { agendamentos: [], observacao: 'Cliente ainda não cadastrado.' }, isError: false };
  const items = list.map((a) => {
    const p = localParts(a.startsAt, tz);
    return {
      id: a.id,
      data: p.date,
      dia_semana: p.weekday,
      hora: p.time,
      servicos: a.items.map((i) => i.serviceName),
      profissional: a.professional.name,
      status: a.status === 'CONFIRMED' ? 'confirmado' : 'pendente',
      valor:
        a.totalPriceCents === null
          ? 'sob consulta'
          : `${a.priceIsEstimate ? 'a partir de ' : ''}${formatBRL(a.totalPriceCents)}`,
    };
  });
  return {
    result: { cliente: customer.name, agendamentos: items },
    isError: false,
    evidence: {
      slots: items.map((i) => ({ date: i.data, time: i.hora })),
      quotedPricesCents: list.flatMap((a) => (a.totalPriceCents === null ? [] : [a.totalPriceCents])),
      hasConfirmedAppointment: list.some((a) => a.status === 'CONFIRMED'),
    },
    effects: { customerId: customer.id },
  };
}

/** Garante que o agendamento é do cliente desta conversa e respeita o prazo de alteração. */
async function ownAppointment(ctx: ToolContext, id: string) {
  const { customer, list } = await upcomingOfCustomer(ctx);
  const a = list.find((x) => x.id === id);
  if (!customer || !a) return { error: 'Agendamento não encontrado entre os agendamentos deste cliente.' };
  const minNotice = ctx.svc.tenant.cancellationMinNoticeMin;
  const minutesUntil = (Date.parse(a.startsAt) - ctx.svc.deps.clock().getTime()) / 60_000;
  if (minNotice > 0 && minutesUntil < minNotice) {
    return {
      error: `Fora do prazo para alterações pela recepcionista (mínimo de ${minNotice} minutos de antecedência). Transfira para a equipe.`,
    };
  }
  return { appointment: a };
}

async function cancelarAgendamento(
  ctx: ToolContext,
  input: z.infer<(typeof SCHEMAS)['cancelar_agendamento']>,
): Promise<ToolOutcome> {
  const own = await ownAppointment(ctx, input.agendamento_id);
  if ('error' in own) return fail(own.error!);
  if (ctx.conversation.isSimulation) {
    return { result: { simulacao: true, cancelado: true }, isError: false, evidence: { cancelled: true } };
  }
  try {
    await cancelAppointment(ctx.svc, input.agendamento_id, {
      cancelledBy: 'CUSTOMER',
      reason: input.motivo ?? 'Cancelado pelo cliente com a recepcionista virtual',
    });
    return { result: { cancelado: true }, isError: false, evidence: { cancelled: true } };
  } catch (err) {
    return toolError(err);
  }
}

async function remarcarAgendamento(
  ctx: ToolContext,
  input: z.infer<(typeof SCHEMAS)['remarcar_agendamento']>,
): Promise<ToolOutcome> {
  const own = await ownAppointment(ctx, input.agendamento_id);
  if ('error' in own) return fail(own.error!);
  const tz = ctx.svc.tenant.timezone;
  const pro = input.profissional
    ? await withTenant(ctx.svc.deps.db, ctx.svc.tenant.id, (tx) =>
        resolveProfessionalName(tx, input.profissional!),
      )
    : null;
  if (pro && !pro.ok) return fail(pro.error, { opcoes_validas: pro.available });
  const startsAt = new Date(localToInstant(input.data, input.hora, tz)).toISOString();
  const slot = { date: input.data, time: input.hora };

  if (ctx.conversation.isSimulation) {
    try {
      const a = await getAvailability(ctx.svc, {
        serviceIds: own.appointment!.items.map((i) => i.serviceId),
        professionalId: pro?.ok ? pro.id : own.appointment!.professional.id,
        from: input.data,
        to: input.data,
        forAi: true,
        excludeAppointmentId: input.agendamento_id,
      });
      if (!a.slots.some((s) => s.start === startsAt)) {
        return fail('Este horário não está livre. O agendamento original foi mantido.');
      }
      return {
        result: { simulacao: true, remarcado: true, data: input.data, hora: input.hora },
        isError: false,
        evidence: { rescheduled: true, slots: [slot] },
      };
    } catch (err) {
      return toolError(err);
    }
  }
  try {
    const a = await rescheduleAppointment(
      ctx.svc,
      input.agendamento_id,
      { startsAt, professionalId: pro?.ok ? pro.id : undefined },
      { customerFacing: true, forAi: true },
    );
    const p = localParts(a.startsAt, tz);
    return {
      result: {
        remarcado: true,
        agendamento_id: a.id,
        data: p.date,
        dia_semana: p.weekday,
        hora: p.time,
        profissional: a.professional.name,
      },
      isError: false,
      evidence: { rescheduled: true, slots: [{ date: p.date, time: p.time }] },
    };
  } catch (err) {
    return toolError(err);
  }
}

/** Executa uma chamada de ferramenta do modelo. Entradas são validadas antes de qualquer acesso ao banco. */
export async function executeTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!(name in SCHEMAS)) return fail(`Ferramenta desconhecida: ${name}.`);
  const parsed = SCHEMAS[name as ToolName].safeParse(rawInput ?? {});
  if (!parsed.success) {
    return fail('Parâmetros inválidos.', {
      detalhes: parsed.error.issues.map((i) => `${i.path.join('.') || '(entrada)'}: ${i.message}`),
    });
  }
  const input = parsed.data as never;
  switch (name as ToolName) {
    case 'interpretar_data':
      return interpretarData(ctx, input);
    case 'consultar_horarios':
      return consultarHorarios(ctx, input);
    case 'reservar_horario':
      return reservarHorario(ctx, input);
    case 'confirmar_reserva':
      return confirmarReserva(ctx, input);
    case 'meus_agendamentos':
      return meusAgendamentos(ctx);
    case 'cancelar_agendamento':
      return cancelarAgendamento(ctx, input);
    case 'remarcar_agendamento':
      return remarcarAgendamento(ctx, input);
    case 'transferir_para_humano': {
      const { motivo } = input as { motivo: string };
      return {
        result: {
          transferido: true,
          orientacao: 'Avise o cliente que a equipe vai continuar o atendimento.',
        },
        isError: false,
        effects: { handoffReason: motivo },
      };
    }
  }
}
