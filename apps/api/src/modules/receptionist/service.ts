import type {
  ConversationDetailDto,
  ConversationMessageDto,
  ConversationSummaryDto,
  CustomerTurnDto,
  ReceptionistStatusDto,
  StartSimulationInput,
} from '@barber-voice/contracts';
import {
  conversationMessages,
  conversations,
  customers,
  receptionistConfigs,
  withTenant,
} from '@barber-voice/db';
import { and, asc, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import type { ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError, Errors } from '../../lib/errors';
import { compileSavedReceptionist } from '../voice-studio/service';
import { handleCustomerMessage } from './engine';

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof conversationMessages.$inferSelect;

/** Contexto com a recepcionista como autora (auditoria registra "AI", sem usuário). */
export function aiContext(ctx: ServiceContext): ServiceContext {
  return { ...ctx, actor: { userId: null, role: null, type: 'AI' } };
}

function requireLlm(ctx: ServiceContext) {
  if (!ctx.deps.llm) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'A recepcionista de IA ainda não está integrada: configure um provedor de modelo de linguagem (ver INTEGRATIONS.md).',
    );
  }
  return ctx.deps.llm;
}

export async function getReceptionistStatus(ctx: ServiceContext): Promise<ReceptionistStatusDto> {
  const [config] = await withTenant(ctx.deps.db, ctx.tenant.id, (tx) =>
    tx.select({ id: receptionistConfigs.tenantId }).from(receptionistConfigs).limit(1),
  );
  return {
    llm: {
      configured: Boolean(ctx.deps.llm),
      provider: ctx.deps.llm?.provider ?? null,
      model: ctx.deps.llm?.model ?? null,
    },
    receptionistConfigured: Boolean(config),
  };
}

function toMessageDto(m: MessageRow): ConversationMessageDto {
  const v = m.verification as { rejected?: unknown[]; fallback?: string | null } | null;
  const out = m.toolOutput as { isError?: boolean } | null;
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    toolName: m.toolName,
    toolError: m.role === 'TOOL' ? Boolean(out?.isError) : null,
    verification: v ? { rejected: v.rejected?.length ?? 0, fallback: v.fallback ?? null } : null,
    createdAt: m.createdAt.toISOString(),
  };
}

function toSummary(
  c: ConversationRow,
  customer: { id: string; name: string } | null,
  last: MessageRow | null,
): ConversationSummaryDto {
  return {
    id: c.id,
    channel: c.channel,
    status: c.status,
    isSimulation: c.isSimulation,
    contactName: c.contactName,
    contactPhone: c.contactPhone,
    customer,
    handoffReason: c.handoffReason,
    messageCount: c.messageCount,
    lastMessage: last
      ? { role: last.role, content: last.content.slice(0, 160), at: last.createdAt.toISOString() }
      : null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listConversations(
  ctx: ServiceContext,
  q: { status?: ConversationRow['status'] | undefined; simulations: boolean },
): Promise<ConversationSummaryDto[]> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(conversations)
      .where(
        and(
          q.status ? eq(conversations.status, q.status) : undefined,
          eq(conversations.isSimulation, q.simulations),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(100);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const customerIds = rows.flatMap((r) => (r.customerId ? [r.customerId] : []));
    const custs = customerIds.length
      ? await tx
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : [];
    const msgs = await tx
      .select()
      .from(conversationMessages)
      .where(and(inArray(conversationMessages.conversationId, ids), ne(conversationMessages.role, 'TOOL')))
      .orderBy(desc(conversationMessages.createdAt));
    const lastBy = new Map<string, MessageRow>();
    for (const m of msgs) if (!lastBy.has(m.conversationId)) lastBy.set(m.conversationId, m);
    const custBy = new Map(custs.map((c) => [c.id, c]));
    return rows.map((r) =>
      toSummary(r, r.customerId ? (custBy.get(r.customerId) ?? null) : null, lastBy.get(r.id) ?? null),
    );
  });
}

export async function getConversation(ctx: ServiceContext, id: string): Promise<ConversationDetailDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    if (!c) throw Errors.notFound('Conversa');
    const msgs = await tx
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, id))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
    const [cust] = c.customerId
      ? await tx
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(eq(customers.id, c.customerId))
      : [];
    const last = [...msgs].reverse().find((m) => m.role !== 'TOOL') ?? null;
    return {
      ...toSummary(c, cust ?? null, last),
      personaVersion: c.personaVersion,
      instructionsHash: c.instructionsHash,
      model: c.model,
      messages: msgs.map(toMessageDto),
    };
  });
}

/** Inicia uma conversa de simulação com as instruções da configuração salva (congeladas). */
/** Janela em que mensagens do mesmo contato continuam a mesma conversa. */
export const CONVERSATION_WINDOW_MS = 12 * 3_600_000;

/**
 * Conversa de um canal real (WhatsApp/telefone) para um contato: reaproveita a conversa aberta
 * recente ou cria uma nova com as instruções congeladas. Sem recepcionista configurada ou sem
 * provedor de IA, a conversa já nasce com a equipe (as mensagens nunca se perdem).
 */
export async function openChannelConversation(
  ai: ServiceContext,
  input: { channel: ConversationRow['channel']; contactPhone: string; contactName?: string | null },
): Promise<string> {
  const llm = ai.deps.llm;
  const now = ai.deps.clock();
  return withTenant(ai.deps.db, ai.tenant.id, async (tx) => {
    const [existing] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.isSimulation, false),
          eq(conversations.channel, input.channel),
          eq(conversations.contactPhone, input.contactPhone),
          inArray(conversations.status, ['OPEN', 'HANDOFF']),
          gt(conversations.lastMessageAt, new Date(now.getTime() - CONVERSATION_WINDOW_MS)),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    if (existing) return existing.id;

    let compiled: Awaited<ReturnType<typeof compileSavedReceptionist>> | null = null;
    try {
      compiled = await compileSavedReceptionist(tx, ai.tenant.id, input.channel);
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'RECEPTIONIST_NOT_CONFIGURED')) throw err;
    }
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.phone, input.contactPhone), isNull(customers.anonymizedAt)))
      .limit(1);
    const handoffReason = !compiled
      ? 'Recepcionista não configurada no Voice Studio'
      : !llm
        ? 'Recepcionista de IA não integrada'
        : null;
    const [c] = await tx
      .insert(conversations)
      .values({
        tenantId: ai.tenant.id,
        channel: input.channel,
        status: handoffReason ? 'HANDOFF' : 'OPEN',
        handoffReason,
        handoffAt: handoffReason ? now : null,
        customerId: customer?.id ?? null,
        contactPhone: input.contactPhone,
        contactName: input.contactName ?? null,
        personaId: compiled?.personaId ?? null,
        personaVersion: compiled?.personaVersion ?? null,
        instructionsHash: compiled?.compiled.hash ?? null,
        systemPrompt: compiled?.compiled.system ?? null,
        language: compiled?.compiled.effective ?? null,
        model: llm?.model ?? null,
      })
      .returning({ id: conversations.id });
    return c!.id;
  });
}

export async function startSimulation(
  ctx: ServiceContext,
  input: StartSimulationInput,
): Promise<ConversationDetailDto> {
  const llm = requireLlm(ctx);
  const id = await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const { compiled, personaId, personaVersion } = await compileSavedReceptionist(
      tx,
      ctx.tenant.id,
      input.channel,
    );
    const [c] = await tx
      .insert(conversations)
      .values({
        tenantId: ctx.tenant.id,
        channel: input.channel,
        isSimulation: true,
        contactPhone: input.contactPhone ?? null,
        contactName: input.contactName ?? null,
        personaId,
        personaVersion,
        instructionsHash: compiled.hash,
        systemPrompt: compiled.system,
        language: compiled.effective,
        model: llm.model,
        startedByUserId: ctx.actor.userId,
      })
      .returning({ id: conversations.id });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      actorType: ctx.actor.type,
      action: 'conversation.simulation_started',
      entityType: 'conversation',
      entityId: c!.id,
      metadata: { channel: input.channel, instructionsHash: compiled.hash },
      ...ctx.meta,
    });
    return c!.id;
  });
  return getConversation(ctx, id);
}

export async function sendSimulatorMessage(
  ctx: ServiceContext,
  conversationId: string,
  text: string,
): Promise<CustomerTurnDto> {
  requireLlm(ctx);
  const [c] = await withTenant(ctx.deps.db, ctx.tenant.id, (tx) =>
    tx
      .select({ isSimulation: conversations.isSimulation })
      .from(conversations)
      .where(eq(conversations.id, conversationId)),
  );
  if (!c) throw Errors.notFound('Conversa');
  if (!c.isSimulation) {
    throw Errors.forbidden('Mensagens de clientes reais chegam apenas pelos canais (WhatsApp/telefone).');
  }
  const turn = await handleCustomerMessage(aiContext(ctx), conversationId, text);
  return {
    reply: turn.reply,
    speech: turn.speech,
    status: turn.status,
    handoffReason: turn.handoffReason,
    conversation: await getConversation(ctx, conversationId),
  };
}

async function setStatus(
  ctx: ServiceContext,
  id: string,
  status: ConversationRow['status'],
  action: string,
): Promise<ConversationDetailDto> {
  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, id)).for('update');
    if (!c) throw Errors.notFound('Conversa');
    if (c.status === 'CLOSED') throw Errors.conflict('CONVERSATION_CLOSED', 'Esta conversa foi encerrada.');
    const now = ctx.deps.clock();
    await tx
      .update(conversations)
      .set({
        status,
        ...(status === 'HANDOFF'
          ? {
              assignedUserId: ctx.actor.userId,
              handoffAt: c.handoffAt ?? now,
              handoffReason: c.handoffReason ?? 'Assumida pela equipe',
            }
          : {}),
        ...(status === 'OPEN' ? { assignedUserId: null, handoffReason: null, handoffAt: null } : {}),
        ...(status === 'CLOSED' ? { closedAt: now } : {}),
      })
      .where(eq(conversations.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      actorType: ctx.actor.type,
      action,
      entityType: 'conversation',
      entityId: id,
      metadata: { from: c.status, to: status },
      ...ctx.meta,
    });
  });
  return getConversation(ctx, id);
}

/** A equipe assume: a recepcionista para de responder nesta conversa. */
export const takeOverConversation = (ctx: ServiceContext, id: string) =>
  setStatus(ctx, id, 'HANDOFF', 'conversation.taken_over');

/** Devolve a conversa para a recepcionista. */
export async function returnConversationToAi(ctx: ServiceContext, id: string) {
  requireLlm(ctx);
  return setStatus(ctx, id, 'OPEN', 'conversation.returned_to_ai');
}

export const closeConversation = (ctx: ServiceContext, id: string) =>
  setStatus(ctx, id, 'CLOSED', 'conversation.closed');
