import type Anthropic from '@anthropic-ai/sdk';
import {
  type ClaimEvidence,
  type ClaimViolation,
  type EffectiveLanguage,
  type StyleViolation,
  WEEKDAY_NAMES_PT,
  checkResponseStyle,
  extractClaims,
  extractTimes,
  instantToLocal,
  toSpeechText,
  verifyClaims,
} from '@barber-voice/core';
import {
  type Tx,
  businessHours,
  conversationLlmTurns,
  conversationMessages,
  conversations,
  professionalServices,
  services,
  withTenant,
} from '@barber-voice/db';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { ServiceContext } from '../../context';
import { Errors } from '../../lib/errors';
import { type LlmMessage, LlmUnavailableError } from './llm';
import { type HoldRecord, type ToolEvidence, type ToolOutcome, TOOL_DEFINITIONS, executeTool } from './tools';

type ConversationRow = typeof conversations.$inferSelect;

const MAX_TOOL_ROUNDS = 8;
const MAX_CORRECTIONS = 2;
/** Conversas muito longas viram uma nova conversa (instruções e fatos atualizados). */
export const MAX_TURNS_PER_CONVERSATION = 40;

/** Violações de estilo que impedem o envio (as demais são registradas ou corrigidas automaticamente). */
const BLOCKING_STYLE = new Set<StyleViolation['code']>([
  'EMOJI_NOT_ALLOWED',
  'TOO_MANY_EMOJIS',
  'FORBIDDEN_TERM',
  'INTIMATE_TERM',
  'CASUAL_IN_FORMAL',
]);

export const SAFE_REPLIES = {
  VERIFICATION:
    'Desculpe, não consegui confirmar essa informação com segurança agora. Vou pedir para alguém da equipe continuar o seu atendimento, tudo bem?',
  UNAVAILABLE:
    'Desculpe, estou com uma instabilidade no momento. Vou pedir para alguém da equipe te responder em seguida.',
  REFUSAL:
    'Desculpe, não consigo ajudar com esse assunto por aqui. Vou pedir para alguém da equipe continuar o atendimento.',
  INCOMPLETE:
    'Desculpe, não consegui concluir sua solicitação agora. Vou pedir para alguém da equipe continuar o atendimento.',
} as const;
export type FallbackKind = keyof typeof SAFE_REPLIES;

export interface TurnVerification {
  /** Respostas do modelo descartadas pelo verificador antes da resposta final. */
  rejected: {
    violations: (ClaimViolation | { code: StyleViolation['code']; raw: string; message: string })[];
  }[];
  /** Avisos de estilo não bloqueantes da resposta enviada. */
  style: StyleViolation[];
  fallback: FallbackKind | null;
}

export interface TurnResult {
  /** Texto enviado ao cliente (null quando a conversa está com a equipe). */
  reply: string | null;
  /** Versão para fala (ligações): números e horários por extenso, sem marcação. */
  speech: string | null;
  status: ConversationRow['status'];
  handoffReason: string | null;
  verification: TurnVerification | null;
  toolCalls: { name: string; isError: boolean }[];
}

interface StoredToolOutput {
  result: Record<string, unknown>;
  isError: boolean;
  evidence?: ToolEvidence;
  turnSeq: number;
}

interface Usage {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

// Uma rodada por vez em cada conversa (neste processo). Com várias instâncias, a fila de
// mensagens por contato (Fase 4b) garante a ordem; a unicidade de `seq` no banco é a última barreira.
const inFlight = new Map<string, Promise<unknown>>();
async function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(key) === run) inFlight.delete(key);
  }
}

function nowText(now: Date, tz: string): string {
  const p = instantToLocal(now.getTime(), tz);
  const [y, m, d] = p.date.split('-');
  return `Data e hora atuais: ${WEEKDAY_NAMES_PT[p.weekday]}, ${d}/${m}/${y} (${p.date}), ${p.time} — fuso ${tz}.`;
}

function correctionText(violations: TurnVerification['rejected'][number]['violations']): string {
  return [
    'VERIFICAÇÃO DA PLATAFORMA: a resposta anterior NÃO foi enviada ao cliente porque:',
    ...violations.map((v) => `- ${v.message}`),
    'Reescreva usando somente os DADOS DO ESTABELECIMENTO e os resultados das ferramentas desta conversa. Se precisar de horário, preço ou confirmação, use a ferramenta adequada. Não mencione esta verificação ao cliente.',
  ].join('\n');
}

const STYLE_MESSAGES: Partial<Record<StyleViolation['code'], string>> = {
  EMOJI_NOT_ALLOWED: 'Emojis não são permitidos neste canal/configuração.',
  TOO_MANY_EMOJIS: 'Use no máximo um emoji por mensagem.',
  FORBIDDEN_TERM: 'A resposta usa um termo que o estabelecimento pediu para evitar.',
  INTIMATE_TERM: 'A resposta usa um termo de intimidade excessiva.',
  CASUAL_IN_FORMAL: 'A resposta usa linguagem informal, mas a configuração é formal.',
};

async function baseEvidence(tx: Tx) {
  const svc = await tx
    .select({ price: services.priceCents })
    .from(services)
    .where(and(eq(services.active, true), isNull(services.archivedAt), isNotNull(services.priceCents)));
  const overrides = await tx
    .select({ price: professionalServices.priceCents })
    .from(professionalServices)
    .where(isNotNull(professionalServices.priceCents));
  const hours = await tx.select().from(businessHours);
  return {
    catalogPricesCents: [...svc, ...overrides].map((r) => r.price!),
    businessHours: hours.map((h) => ({
      weekday: h.weekday,
      start: h.startTime.slice(0, 5),
      end: h.endTime.slice(0, 5),
    })),
  };
}

function mergeEvidence(
  base: Awaited<ReturnType<typeof baseEvidence>>,
  tools: ToolEvidence[],
  customerTimes: string[],
): ClaimEvidence {
  return {
    catalogPricesCents: base.catalogPricesCents,
    quotedPricesCents: tools.flatMap((t) => t.quotedPricesCents ?? []),
    slots: tools.flatMap((t) => t.slots ?? []),
    customerTimes,
    businessHours: base.businessHours,
    actions: {
      booked: tools.some((t) => t.booked || t.hasConfirmedAppointment),
      held: tools.some((t) => t.hold),
      cancelled: tools.some((t) => t.cancelled),
      rescheduled: tools.some((t) => t.rescheduled),
    },
  };
}

async function loadState(tx: Tx, conv: ConversationRow) {
  const turns = await tx
    .select()
    .from(conversationLlmTurns)
    .where(eq(conversationLlmTurns.conversationId, conv.id))
    .orderBy(asc(conversationLlmTurns.seq));
  const rows = await tx
    .select({
      role: conversationMessages.role,
      content: conversationMessages.content,
      toolOutput: conversationMessages.toolOutput,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conv.id))
    .orderBy(asc(conversationMessages.createdAt));
  const tools = rows
    .filter((r) => r.role === 'TOOL' && r.toolOutput)
    .map((r) => r.toolOutput as StoredToolOutput);
  return {
    history: turns.flatMap((t) => t.messages as LlmMessage[]),
    nextSeq: (turns.at(-1)?.seq ?? 0) + 1,
    toolEvidence: tools.flatMap((t) => (t.evidence ? [t.evidence] : [])),
    holds: tools.flatMap((t) => (t.evidence?.hold ? [t.evidence.hold] : [])),
    customerTimes: rows.filter((r) => r.role === 'CUSTOMER').flatMap((r) => extractTimes(r.content)),
    base: await baseEvidence(tx),
  };
}

function addUsage(total: Usage, u: Anthropic.Beta.BetaUsage | undefined) {
  total.calls++;
  if (!u) return;
  total.input_tokens += u.input_tokens ?? 0;
  total.output_tokens += u.output_tokens ?? 0;
  total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
  total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
}

const TOOL_LABELS: Record<string, string> = {
  interpretar_data: 'Interpretou data/horário',
  consultar_horarios: 'Consultou a agenda',
  reservar_horario: 'Reservou horário temporariamente',
  confirmar_reserva: 'Confirmou agendamento',
  meus_agendamentos: 'Consultou agendamentos do cliente',
  cancelar_agendamento: 'Cancelou agendamento',
  remarcar_agendamento: 'Remarcou agendamento',
  transferir_para_humano: 'Transferiu para a equipe',
};

/**
 * Processa uma mensagem do cliente: o modelo usa as ferramentas sobre a agenda real, e a
 * resposta final só é entregue depois de passar pelo verificador de afirmações e de estilo.
 * O histórico enviado ao modelo é somente-acréscimo (respostas reprovadas nunca entram nele).
 */
export function handleCustomerMessage(
  ai: ServiceContext,
  conversationId: string,
  text: string,
  opts: { externalId?: string | null } = {},
): Promise<TurnResult> {
  return serialize(`${ai.tenant.id}:${conversationId}`, () => runTurn(ai, conversationId, text, opts));
}

async function runTurn(
  ai: ServiceContext,
  conversationId: string,
  text: string,
  opts: { externalId?: string | null },
): Promise<TurnResult> {
  const { db, llm, clock } = ai.deps;
  const tenantId = ai.tenant.id;
  const tz = ai.tenant.timezone;
  const now = clock();

  const conv = await withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    if (!c) throw Errors.notFound('Conversa');
    if (c.status === 'CLOSED') throw Errors.conflict('CONVERSATION_CLOSED', 'Esta conversa foi encerrada.');
    await tx.insert(conversationMessages).values({
      tenantId,
      conversationId,
      role: 'CUSTOMER',
      content: text,
      externalId: opts.externalId ?? null,
    });
    // sem provedor de IA, nenhuma mensagem se perde: a conversa passa para a equipe
    const toTeam = c.status === 'OPEN' && !llm;
    await tx
      .update(conversations)
      .set({
        lastMessageAt: now,
        messageCount: sql`${conversations.messageCount} + 1`,
        ...(toTeam
          ? { status: 'HANDOFF' as const, handoffReason: 'Recepcionista de IA não integrada', handoffAt: now }
          : {}),
      })
      .where(eq(conversations.id, conversationId));
    return toTeam
      ? { ...c, status: 'HANDOFF' as const, handoffReason: 'Recepcionista de IA não integrada' }
      : c;
  });

  // com a equipe: a mensagem fica registrada para atendimento humano
  if (conv.status === 'HANDOFF' || !llm) {
    return {
      reply: null,
      speech: null,
      status: conv.status,
      handoffReason: conv.handoffReason,
      verification: null,
      toolCalls: [],
    };
  }
  if (!conv.systemPrompt || !conv.language) {
    throw Errors.conflict('CONVERSATION_NOT_READY', 'Conversa sem instruções da recepcionista.');
  }
  const system = conv.systemPrompt;
  const language = conv.language as EffectiveLanguage;

  const state = await withTenant(db, tenantId, (tx) => loadState(tx, conv));
  if (state.nextSeq > MAX_TURNS_PER_CONVERSATION) {
    throw Errors.conflict('CONVERSATION_TOO_LONG', 'Conversa muito longa. Inicie uma nova conversa.');
  }
  const turnSeq = state.nextSeq;
  const turn: LlmMessage[] = [{ role: 'user', content: [{ type: 'text', text }] }];
  // mensagem de sistema de cauda: "agora" e correções do verificador; só entra no histórico
  // junto com uma resposta aceita (respostas descartadas não deixam rastro no prefixo)
  let tail: string[] = [nowText(now, tz)];
  const flushTail = () => {
    if (tail.length) turn.push({ role: 'system', content: tail.join('\n\n') });
    tail = [];
  };

  const toolEvidence = [...state.toolEvidence];
  const holds: HoldRecord[] = [...state.holds];
  const customerTimes = [...state.customerTimes];
  let customerId = conv.customerId;
  let handoffReason: string | null = null;
  const verification: TurnVerification = { rejected: [], style: [], fallback: null };
  const usage: Usage = {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  const toolCalls: TurnResult['toolCalls'] = [];
  let reply: string | null = null;
  let toolRounds = 0;

  while (reply === null && verification.fallback === null) {
    const messages: LlmMessage[] = [...state.history, ...turn];
    if (tail.length) messages.push({ role: 'system', content: tail.join('\n\n') });

    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await llm.complete({ system, tools: TOOL_DEFINITIONS, messages });
    } catch (err) {
      if (err instanceof LlmUnavailableError) {
        verification.fallback = 'UNAVAILABLE';
        break;
      }
      throw err;
    }
    addUsage(usage, res.usage);

    if (res.stop_reason === 'refusal') {
      verification.fallback = 'REFUSAL';
      break;
    }
    if (res.stop_reason === 'max_tokens') {
      verification.fallback = 'INCOMPLETE';
      break;
    }
    if (res.stop_reason === 'tool_use' || res.stop_reason === 'pause_turn') {
      flushTail();
      turn.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'pause_turn') continue;
      if (++toolRounds > MAX_TOOL_ROUNDS) {
        verification.fallback = 'INCOMPLETE';
        // resultado obrigatório para cada chamada pendente, mantendo o histórico válido
        turn.push({
          role: 'user',
          content: res.content
            .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
            .map((b) => ({
              type: 'tool_result' as const,
              tool_use_id: b.id,
              content: 'Limite de etapas atingido.',
              is_error: true,
            })),
        });
        break;
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        const outcome: ToolOutcome = await executeTool(
          { svc: ai, conversation: { ...conv, customerId }, turnSeq, holds, toolUseId: block.id },
          block.name,
          block.input,
        );
        if (outcome.evidence) {
          toolEvidence.push(outcome.evidence);
          if (outcome.evidence.hold) holds.push(outcome.evidence.hold);
        }
        if (outcome.effects?.customerId) customerId = outcome.effects.customerId;
        if (outcome.effects?.handoffReason) handoffReason = outcome.effects.handoffReason;
        toolCalls.push({ name: block.name, isError: outcome.isError });
        const stored: StoredToolOutput = { ...outcome, turnSeq };
        delete (stored as { effects?: unknown }).effects;
        await withTenant(db, tenantId, (tx) =>
          tx.insert(conversationMessages).values({
            tenantId,
            conversationId,
            role: 'TOOL',
            content: `${TOOL_LABELS[block.name] ?? block.name}${outcome.isError ? ' (sem sucesso)' : ''}`,
            toolName: block.name,
            toolInput: block.input as object,
            toolOutput: stored,
          }),
        );
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(outcome.result),
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      turn.push({ role: 'user', content: results });
      continue;
    }

    // resposta final candidata: verificar antes de entregar
    const candidate = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const evidence = mergeEvidence(state.base, toolEvidence, customerTimes);
    const claimViolations = candidate
      ? verifyClaims(extractClaims(candidate, { now: now.getTime(), timezone: tz }), evidence)
      : [];
    const style = candidate ? checkResponseStyle(candidate, language) : [];
    const blocking = style
      .filter((v) => BLOCKING_STYLE.has(v.code))
      .map((v) => ({ code: v.code, raw: v.detail, message: STYLE_MESSAGES[v.code] ?? v.detail }));
    const empty = candidate
      ? []
      : [{ code: 'EMPTY' as never, raw: '', message: 'A resposta veio vazia. Responda ao cliente.' }];
    const problems = [...claimViolations, ...blocking, ...empty];

    if (problems.length === 0) {
      flushTail();
      turn.push({ role: 'assistant', content: res.content });
      verification.style = style;
      reply = candidate;
      break;
    }
    verification.rejected.push({ violations: problems });
    if (verification.rejected.length > MAX_CORRECTIONS) {
      verification.fallback = 'VERIFICATION';
      break;
    }
    tail.push(correctionText(problems));
  }

  if (verification.fallback) {
    reply = SAFE_REPLIES[verification.fallback];
    handoffReason ??= `Atendimento automático interrompido (${verification.fallback.toLowerCase()}).`;
    flushTail();
    turn.push({ role: 'assistant', content: [{ type: 'text', text: reply }] });
  }

  const status: ConversationRow['status'] = handoffReason ? 'HANDOFF' : 'OPEN';
  await withTenant(db, tenantId, async (tx) => {
    await tx
      .insert(conversationLlmTurns)
      .values({ tenantId, conversationId, seq: turnSeq, messages: turn, usage });
    await tx.insert(conversationMessages).values({
      tenantId,
      conversationId,
      role: 'ASSISTANT',
      content: reply!,
      verification,
    });
    await tx
      .update(conversations)
      .set({
        status,
        customerId,
        lastMessageAt: clock(),
        messageCount: sql`${conversations.messageCount} + 1`,
        ...(handoffReason ? { handoffReason, handoffAt: clock() } : {}),
      })
      .where(eq(conversations.id, conversationId));
  });

  const speech = conv.channel === 'PHONE' ? toSpeechText(reply!) : null;
  return { reply, speech, status, handoffReason, verification, toolCalls };
}
