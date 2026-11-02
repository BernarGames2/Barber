import type { AppointmentDto, AppointmentSource } from '@barber-voice/contracts';
import { SLOT_REJECTION_LABELS } from '@barber-voice/contracts';
import {
  type SlotRejectionReason,
  addDays,
  instantToLocal,
  rankProfessionals,
  startOfLocalDay,
  validateSlot,
} from '@barber-voice/core';
import {
  PG_ERROR,
  type Tx,
  appointmentItems,
  appointments,
  customers,
  lockProfessionalSchedule,
  pgConstraintName,
  pgErrorCode,
  withTenant,
} from '@barber-voice/db';
import { and, asc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError, Errors } from '../../lib/errors';
import { can } from '../../lib/permissions';
import {
  type EligibleProfessional,
  eligibleProfessionals,
  expireStaleHolds,
  loadAppointmentDtos,
  loadSchedulingData,
  resolveServices,
} from './queries';

const DAY_MS = 86_400_000;

export interface BookingRequest {
  customerId?: string | undefined;
  newCustomer?: { name: string; phone?: string | null | undefined } | undefined;
  /** Omitido = qualquer profissional disponível. */
  professionalId?: string | undefined;
  serviceIds: string[];
  startsAt: string;
  notes?: string | null | undefined;
  source: AppointmentSource;
  isOverbook?: boolean;
  allowOutsideHours?: boolean;
  allowPast?: boolean;
}

export interface BookingOptions {
  idempotencyKey?: string | null | undefined;
  /**
   * Aplica a política voltada ao cliente (antecedência mínima e limite de dias).
   * Sempre verdadeiro para a recepcionista de IA; no painel, a equipe pode marcar em cima da hora.
   */
  customerFacing?: boolean;
  /** Canal de IA: só serviços/profissionais "agendáveis pela IA" e nenhuma exceção manual. */
  forAi?: boolean;
  /** Cria reserva temporária (HELD) que expira — usada pela IA enquanto confirma dados. */
  holdTtlSec?: number;
}

export interface BookingResult {
  appointment: AppointmentDto;
  replayed: boolean;
}

export class SlotUnavailableError extends AppError {
  constructor(public readonly reason: SlotRejectionReason | 'NO_PROFESSIONAL_AVAILABLE') {
    super(
      409,
      'SLOT_UNAVAILABLE',
      reason === 'NO_PROFESSIONAL_AVAILABLE'
        ? 'Nenhum profissional disponível neste horário.'
        : (SLOT_REJECTION_LABELS[reason] ?? 'Horário indisponível.'),
      { reason },
    );
  }
}

class IdempotencyCollision extends Error {}

const SOURCE_TO_CUSTOMER_SOURCE = {
  DASHBOARD: 'DASHBOARD',
  WALK_IN: 'WALK_IN',
  AI_PHONE: 'PHONE',
  AI_WHATSAPP: 'WHATSAPP',
  ONLINE: 'ONLINE',
  IMPORT: 'IMPORT',
} as const;

function policyFor(ctx: ServiceContext, customerFacing: boolean) {
  return {
    timezone: ctx.tenant.timezone,
    slotIntervalMin: ctx.tenant.slotIntervalMin,
    minNoticeMin: customerFacing ? ctx.tenant.minBookingNoticeMin : 0,
    maxDaysAhead: customerFacing ? ctx.tenant.maxBookingDaysAhead : 365,
  };
}

async function findByIdempotencyKey(ctx: ServiceContext, key: string): Promise<AppointmentDto | null> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.idempotencyKey, key))
      .limit(1);
    return row ? ((await loadAppointmentDtos(tx, [row.id]))[0] ?? null) : null;
  });
}

async function resolveCustomer(tx: Tx, ctx: ServiceContext, req: BookingRequest): Promise<string> {
  if (req.customerId) {
    const [c] = await tx
      .select({ id: customers.id, anonymizedAt: customers.anonymizedAt })
      .from(customers)
      .where(eq(customers.id, req.customerId))
      .limit(1);
    if (!c || c.anonymizedAt) throw Errors.notFound('Cliente');
    return c.id;
  }
  const nc = req.newCustomer;
  if (!nc) throw Errors.validation([{ path: 'customerId', message: 'Informe o cliente.' }]);
  if (nc.phone) {
    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.phone, nc.phone), isNull(customers.anonymizedAt)))
      .limit(1);
    if (existing) return existing.id;
  }
  const [c] = await tx
    .insert(customers)
    .values({
      tenantId: ctx.tenant.id,
      name: nc.name,
      phone: nc.phone ?? null,
      source: SOURCE_TO_CUSTOMER_SOURCE[req.source],
      createdAt: ctx.deps.clock(),
    })
    .returning({ id: customers.id });
  await audit(tx, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.actor.userId,
    actorType: ctx.actor.type,
    action: 'customer.created',
    entityType: 'customer',
    entityId: c!.id,
    metadata: { via: 'booking' },
    ...ctx.meta,
  });
  return c!.id;
}

function validateFor(
  ctx: ServiceContext,
  req: BookingRequest,
  prof: EligibleProfessional,
  data: Awaited<ReturnType<typeof loadSchedulingData>>,
  startMs: number,
  now: Date,
  customerFacing: boolean,
) {
  const sched = data.byProfessional.get(prof.id) ?? { workingHours: null, timeOff: [], busy: [] };
  return validateSlot({
    ...policyFor(ctx, customerFacing),
    businessHours: data.businessHours,
    closures: data.closures,
    professional: {
      professionalId: prof.id,
      workingHours: sched.workingHours,
      timeOff: sched.timeOff,
      busy: sched.busy,
      durationMin: prof.durationMin,
      bufferAfterMin: prof.bufferAfterMin,
    },
    start: startMs,
    now: now.getTime(),
    ignoreConflicts: Boolean(req.isOverbook),
    ignoreWorkingHours: Boolean(req.allowOutsideHours),
    ignoreNotice: Boolean(req.allowPast),
  });
}

/** Profissionais aptos e livres no instante pedido, na ordem de distribuição. */
async function freeProfessionalsAt(
  ctx: ServiceContext,
  req: BookingRequest,
  startMs: number,
  opts: BookingOptions,
) {
  const now = ctx.deps.clock();
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const svc = await resolveServices(tx, req.serviceIds, { forAi: opts.forAi ?? false });
    const eligible = await eligibleProfessionals(tx, svc, undefined, { forAi: opts.forAi ?? false });
    if (eligible.length === 0) {
      throw Errors.unprocessable(
        'NO_PROFESSIONAL_FOR_SERVICE',
        'Nenhum profissional realiza o(s) serviço(s) escolhido(s).',
      );
    }
    const date = instantToLocal(startMs, ctx.tenant.timezone).date;
    const dayStart = new Date(startOfLocalDay(date, ctx.tenant.timezone));
    const dayEnd = new Date(startOfLocalDay(addDays(date, 1), ctx.tenant.timezone));
    const data = await loadSchedulingData(tx, {
      professionalIds: eligible.map((p) => p.id),
      from: new Date(Math.min(dayStart.getTime(), startMs - DAY_MS)),
      to: new Date(Math.max(dayEnd.getTime(), startMs + DAY_MS)),
      now,
    });
    const free = eligible.filter(
      (p) => validateFor(ctx, req, p, data, startMs, now, opts.customerFacing ?? false).ok,
    );
    const load = Object.fromEntries(
      free.map((p) => [
        p.id,
        (data.byProfessional.get(p.id)?.busy ?? [])
          .filter((b) => b.start >= dayStart.getTime() && b.start < dayEnd.getTime())
          .reduce((acc, b) => acc + (b.end - b.start) / 60_000, 0),
      ]),
    );
    let preferred: string | null = null;
    if (req.customerId) {
      const [c] = await tx
        .select({ preferred: customers.preferredProfessionalId })
        .from(customers)
        .where(eq(customers.id, req.customerId))
        .limit(1);
      preferred = c?.preferred ?? null;
    }
    return rankProfessionals(
      free.map((p) => p.id),
      load,
      preferred,
    );
  });
}

async function bookWithProfessional(
  ctx: ServiceContext,
  req: BookingRequest,
  professionalId: string,
  startMs: number,
  key: string | null,
  opts: BookingOptions,
): Promise<AppointmentDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const now = ctx.deps.clock();
    const svc = await resolveServices(tx, req.serviceIds, { forAi: opts.forAi ?? false });
    const [prof] = await eligibleProfessionals(tx, svc, professionalId, { forAi: opts.forAi ?? false });
    if (!prof) {
      throw Errors.unprocessable(
        'PROFESSIONAL_CANNOT_PERFORM',
        'Este profissional não realiza o(s) serviço(s) escolhido(s).',
      );
    }

    // 1) serializa a agenda do profissional  2) libera reservas temporárias vencidas
    await lockProfessionalSchedule(tx, prof.id);
    // Repetição concorrente com a mesma chave: a primeira já gravou enquanto esperávamos o lock.
    if (key) {
      const [dup] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(eq(appointments.idempotencyKey, key))
        .limit(1);
      if (dup) throw new IdempotencyCollision();
    }
    await expireStaleHolds(tx, prof.id, now);

    // 3) revalida com o estado ATUAL do banco, dentro da transação
    const data = await loadSchedulingData(tx, {
      professionalIds: [prof.id],
      from: new Date(startMs - DAY_MS),
      to: new Date(startMs + DAY_MS),
      now,
    });
    const v = validateFor(ctx, req, prof, data, startMs, now, opts.customerFacing ?? false);
    if (!v.ok) throw new SlotUnavailableError(v.reason);

    const customerId = await resolveCustomer(tx, ctx, req);
    const held = Boolean(opts.holdTtlSec && opts.holdTtlSec > 0);

    // 4) grava — a exclusion constraint é a garantia final contra corridas
    let inserted: { id: string };
    try {
      const [row] = await tx
        .insert(appointments)
        .values({
          tenantId: ctx.tenant.id,
          customerId,
          professionalId: prof.id,
          status: held ? 'HELD' : 'CONFIRMED',
          startsAt: new Date(startMs),
          endsAt: new Date(v.end),
          blockedUntil: new Date(v.blockedUntil),
          totalDurationMin: prof.durationMin,
          totalPriceCents: prof.totalPriceCents,
          priceIsEstimate: prof.priceIsEstimate,
          source: req.source,
          isOverbook: Boolean(req.isOverbook),
          holdExpiresAt: held ? new Date(now.getTime() + opts.holdTtlSec! * 1000) : null,
          notes: req.notes ?? null,
          idempotencyKey: key,
          createdByUserId: ctx.actor.userId,
          confirmedAt: held ? null : now,
        })
        .returning({ id: appointments.id });
      inserted = row!;
    } catch (err) {
      const code = pgErrorCode(err);
      if (code === PG_ERROR.EXCLUSION_VIOLATION) throw new SlotUnavailableError('CONFLICT');
      if (
        code === PG_ERROR.UNIQUE_VIOLATION &&
        pgConstraintName(err) === 'appointments_tenant_idempotency_key'
      ) {
        throw new IdempotencyCollision();
      }
      throw err;
    }

    await tx.insert(appointmentItems).values(
      prof.items.map((i, idx) => ({
        tenantId: ctx.tenant.id,
        appointmentId: inserted.id,
        serviceId: i.serviceId,
        serviceName: i.serviceName,
        durationMin: i.durationMin,
        priceCents: i.priceCents,
        priceType: i.priceType,
        sortOrder: idx,
      })),
    );
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      actorType: ctx.actor.type,
      action: held ? 'appointment.held' : 'appointment.created',
      entityType: 'appointment',
      entityId: inserted.id,
      metadata: {
        professionalId: prof.id,
        startsAt: new Date(startMs).toISOString(),
        source: req.source,
        overbook: Boolean(req.isOverbook),
        outsideHours: Boolean(req.allowOutsideHours),
      },
      ...ctx.meta,
    });
    return (await loadAppointmentDtos(tx, [inserted.id]))[0]!;
  });
}

/**
 * Cria um agendamento com proteção contra conflitos, corridas e duplicidade.
 * Só retorna sucesso após a gravação confirmada no banco.
 */
export async function createAppointment(
  ctx: ServiceContext,
  req: BookingRequest,
  opts: BookingOptions = {},
): Promise<BookingResult> {
  const startMs = Date.parse(req.startsAt);
  if (Number.isNaN(startMs)) throw Errors.validation([{ path: 'startsAt', message: 'Data/hora inválida' }]);
  if (opts.forAi && (req.isOverbook || req.allowOutsideHours || req.allowPast)) {
    throw Errors.forbidden('A recepcionista de IA não pode criar encaixes ou exceções de horário.');
  }
  if (req.allowOutsideHours && !can(ctx.actor.role, 'appointments:override-hours')) {
    throw Errors.forbidden('Somente proprietário ou gerente podem agendar fora do horário.');
  }

  const key = opts.idempotencyKey?.trim() ? opts.idempotencyKey.trim().slice(0, 120) : null;
  if (key) {
    const replay = await findByIdempotencyKey(ctx, key);
    if (replay) return { appointment: replay, replayed: true };
  }

  const candidates = req.professionalId
    ? [req.professionalId]
    : await freeProfessionalsAt(ctx, req, startMs, opts);
  if (candidates.length === 0) throw new SlotUnavailableError('NO_PROFESSIONAL_AVAILABLE');

  let lastError: unknown = null;
  for (const professionalId of candidates.slice(0, 5)) {
    try {
      return {
        appointment: await bookWithProfessional(ctx, req, professionalId, startMs, key, opts),
        replayed: false,
      };
    } catch (err) {
      // mesma chave já gravada por uma requisição concorrente: devolve a reserva original
      if (key && (err instanceof IdempotencyCollision || err instanceof SlotUnavailableError)) {
        const replay = await findByIdempotencyKey(ctx, key);
        if (replay) return { appointment: replay, replayed: true };
      }
      // "qualquer profissional": se alguém ocupou este profissional no meio do caminho, tenta o próximo
      if (err instanceof SlotUnavailableError && !req.professionalId) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new SlotUnavailableError('NO_PROFESSIONAL_AVAILABLE');
}

const CANCELLABLE = ['HELD', 'PENDING', 'CONFIRMED'] as const;

async function lockAppointment(tx: Tx, id: string) {
  const [a] = await tx.select().from(appointments).where(eq(appointments.id, id)).for('update').limit(1);
  if (!a) throw Errors.notFound('Agendamento');
  return a;
}

export async function cancelAppointment(
  ctx: ServiceContext,
  id: string,
  input: { reason?: string | null | undefined; cancelledBy: 'CUSTOMER' | 'STAFF' | 'AI' | 'SYSTEM' },
): Promise<AppointmentDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const a = await lockAppointment(tx, id);
    if (!(CANCELLABLE as readonly string[]).includes(a.status)) {
      throw Errors.conflict('INVALID_STATUS_TRANSITION', 'Este agendamento não pode mais ser cancelado.', {
        status: a.status,
      });
    }
    const now = ctx.deps.clock();
    await tx
      .update(appointments)
      .set({
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: input.cancelledBy,
        cancelReason: input.reason ?? null,
        version: sql`${appointments.version} + 1`,
      })
      .where(eq(appointments.id, id));
    if (input.cancelledBy === 'CUSTOMER') {
      await tx
        .update(customers)
        .set({ cancellationCount: sql`${customers.cancellationCount} + 1` })
        .where(eq(customers.id, a.customerId));
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      actorType: ctx.actor.type,
      action: 'appointment.cancelled',
      entityType: 'appointment',
      entityId: id,
      metadata: { cancelledBy: input.cancelledBy, previousStatus: a.status },
      ...ctx.meta,
    });
    return (await loadAppointmentDtos(tx, [id]))[0]!;
  });
}

/**
 * Remarca de forma atômica: na MESMA transação libera o horário antigo e ocupa o novo.
 * Se o novo horário não estiver livre, nada muda (o cliente não perde o horário original).
 */
export async function rescheduleAppointment(
  ctx: ServiceContext,
  id: string,
  input: {
    startsAt: string;
    professionalId?: string | undefined;
    isOverbook?: boolean;
    allowOutsideHours?: boolean;
  },
  opts: { customerFacing?: boolean; forAi?: boolean } = {},
): Promise<AppointmentDto> {
  if (opts.forAi && (input.isOverbook || input.allowOutsideHours)) throw Errors.forbidden();
  if (input.allowOutsideHours && !can(ctx.actor.role, 'appointments:override-hours')) {
    throw Errors.forbidden('Somente proprietário ou gerente podem agendar fora do horário.');
  }
  const startMs = Date.parse(input.startsAt);
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const old = await lockAppointment(tx, id);
    if (!(CANCELLABLE as readonly string[]).includes(old.status)) {
      throw Errors.conflict('INVALID_STATUS_TRANSITION', 'Este agendamento não pode ser remarcado.', {
        status: old.status,
      });
    }
    const items = await tx
      .select()
      .from(appointmentItems)
      .where(eq(appointmentItems.appointmentId, id))
      .orderBy(asc(appointmentItems.sortOrder));
    const targetProfessionalId = input.professionalId ?? old.professionalId;
    const svc = await resolveServices(
      tx,
      items.map((i) => i.serviceId),
      { forAi: opts.forAi ?? false },
    );
    const [prof] = await eligibleProfessionals(tx, svc, targetProfessionalId, { forAi: opts.forAi ?? false });
    if (!prof)
      throw Errors.unprocessable(
        'PROFESSIONAL_CANNOT_PERFORM',
        'Este profissional não realiza estes serviços.',
      );

    // locks em ordem determinística evitam deadlock entre remarcações cruzadas
    for (const pid of [...new Set([old.professionalId, prof.id])].sort())
      await lockProfessionalSchedule(tx, pid);
    const now = ctx.deps.clock();
    await expireStaleHolds(tx, prof.id, now);

    // mantém duração/preços congelados da reserva original (o que foi combinado com o cliente)
    const frozen: EligibleProfessional = {
      ...prof,
      durationMin: old.totalDurationMin,
      bufferAfterMin: Math.round((old.blockedUntil.getTime() - old.endsAt.getTime()) / 60_000),
    };
    const data = await loadSchedulingData(tx, {
      professionalIds: [prof.id],
      from: new Date(startMs - DAY_MS),
      to: new Date(startMs + DAY_MS),
      now,
      excludeAppointmentId: id,
    });
    const req: BookingRequest = {
      customerId: old.customerId,
      serviceIds: svc.map((s) => s.id),
      startsAt: input.startsAt,
      source: old.source,
      isOverbook: input.isOverbook ?? false,
      allowOutsideHours: input.allowOutsideHours ?? false,
    };
    const v = validateFor(ctx, req, frozen, data, startMs, now, opts.customerFacing ?? false);
    if (!v.ok) throw new SlotUnavailableError(v.reason);

    await tx
      .update(appointments)
      .set({
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: opts.forAi ? 'AI' : 'STAFF',
        cancelReason: 'Remarcado',
        version: sql`${appointments.version} + 1`,
      })
      .where(eq(appointments.id, id));

    let newId: string;
    try {
      const [row] = await tx
        .insert(appointments)
        .values({
          tenantId: ctx.tenant.id,
          customerId: old.customerId,
          professionalId: prof.id,
          status: 'CONFIRMED',
          startsAt: new Date(startMs),
          endsAt: new Date(v.end),
          blockedUntil: new Date(v.blockedUntil),
          totalDurationMin: old.totalDurationMin,
          totalPriceCents: old.totalPriceCents,
          priceIsEstimate: old.priceIsEstimate,
          source: old.source,
          isOverbook: Boolean(input.isOverbook),
          notes: old.notes,
          createdByUserId: ctx.actor.userId,
          confirmedAt: now,
          rescheduledFromId: id,
        })
        .returning({ id: appointments.id });
      newId = row!.id;
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION) throw new SlotUnavailableError('CONFLICT');
      throw err;
    }
    await tx.insert(appointmentItems).values(
      items.map((i) => ({
        tenantId: ctx.tenant.id,
        appointmentId: newId,
        serviceId: i.serviceId,
        serviceName: i.serviceName,
        durationMin: i.durationMin,
        priceCents: i.priceCents,
        priceType: i.priceType,
        sortOrder: i.sortOrder,
      })),
    );
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      actorType: ctx.actor.type,
      action: 'appointment.rescheduled',
      entityType: 'appointment',
      entityId: newId,
      metadata: {
        fromAppointmentId: id,
        fromStartsAt: old.startsAt.toISOString(),
        toStartsAt: new Date(startMs).toISOString(),
        professionalId: prof.id,
      },
      ...ctx.meta,
    });
    return (await loadAppointmentDtos(tx, [newId]))[0]!;
  });
}

const TRANSITIONS: Record<'CONFIRMED' | 'COMPLETED' | 'NO_SHOW', readonly string[]> = {
  CONFIRMED: ['HELD', 'PENDING'],
  COMPLETED: ['CONFIRMED', 'PENDING'],
  NO_SHOW: ['CONFIRMED', 'PENDING'],
};

export async function updateAppointmentStatus(
  ctx: ServiceContext,
  id: string,
  status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW',
): Promise<AppointmentDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const a = await lockAppointment(tx, id);
    if (!TRANSITIONS[status].includes(a.status)) {
      throw Errors.conflict('INVALID_STATUS_TRANSITION', 'Mudança de status não permitida.', {
        from: a.status,
        to: status,
      });
    }
    const now = ctx.deps.clock();
    if ((status === 'COMPLETED' || status === 'NO_SHOW') && a.startsAt.getTime() > now.getTime()) {
      throw Errors.conflict(
        'APPOINTMENT_NOT_STARTED',
        'Só é possível concluir ou marcar falta após o horário de início.',
      );
    }
    await tx
      .update(appointments)
      .set({
        status,
        ...(status === 'CONFIRMED' ? { confirmedAt: now, holdExpiresAt: null } : {}),
        ...(status === 'COMPLETED' ? { completedAt: now } : {}),
        ...(status === 'NO_SHOW' ? { noShowAt: now } : {}),
        version: sql`${appointments.version} + 1`,
      })
      .where(eq(appointments.id, id));

    if (status === 'COMPLETED') {
      await tx
        .update(customers)
        .set({
          visitsCount: sql`${customers.visitsCount} + 1`,
          lastVisitAt: sql`GREATEST(${customers.lastVisitAt}, ${a.startsAt.toISOString()}::timestamptz)`,
          firstVisitAt: sql`LEAST(${customers.firstVisitAt}, ${a.startsAt.toISOString()}::timestamptz)`,
        })
        .where(eq(customers.id, a.customerId));
    }
    if (status === 'NO_SHOW') {
      await tx
        .update(customers)
        .set({ noShowCount: sql`${customers.noShowCount} + 1` })
        .where(eq(customers.id, a.customerId));
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      actorType: ctx.actor.type,
      action: `appointment.${status.toLowerCase()}`,
      entityType: 'appointment',
      entityId: id,
      metadata: { from: a.status },
      ...ctx.meta,
    });
    return (await loadAppointmentDtos(tx, [id]))[0]!;
  });
}

export async function listAppointments(
  ctx: ServiceContext,
  filter: {
    from: string;
    to: string;
    professionalId?: string | undefined;
    customerId?: string | undefined;
    includeCancelled: boolean;
  },
): Promise<AppointmentDto[]> {
  const tz = ctx.tenant.timezone;
  const from = new Date(startOfLocalDay(filter.from, tz));
  const to = new Date(startOfLocalDay(addDays(filter.to, 1), tz));
  if (to.getTime() - from.getTime() > 62 * DAY_MS) {
    throw Errors.unprocessable('RANGE_TOO_LARGE', 'Consulte no máximo 62 dias por vez.');
  }
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const now = ctx.deps.clock();
    const rows = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          gte(appointments.startsAt, from),
          lt(appointments.startsAt, to),
          filter.professionalId ? eq(appointments.professionalId, filter.professionalId) : undefined,
          filter.customerId ? eq(appointments.customerId, filter.customerId) : undefined,
          filter.includeCancelled ? undefined : notInArray(appointments.status, ['CANCELLED', 'EXPIRED']),
          // reservas temporárias vencidas nunca aparecem como ocupando a agenda
          sql`NOT (${appointments.status} = 'HELD' AND ${appointments.holdExpiresAt} <= ${now.toISOString()}::timestamptz)`,
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(2000);
    return loadAppointmentDtos(
      tx,
      rows.map((r) => r.id),
    );
  });
}

export async function getAppointment(ctx: ServiceContext, id: string): Promise<AppointmentDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [dto] = await loadAppointmentDtos(tx, [id]);
    if (!dto) throw Errors.notFound('Agendamento');
    return dto;
  });
}

export async function updateAppointmentNotes(
  ctx: ServiceContext,
  id: string,
  notes: string | null,
): Promise<AppointmentDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const updated = await tx
      .update(appointments)
      .set({ notes })
      .where(
        and(
          eq(appointments.id, id),
          inArray(appointments.status, ['HELD', 'PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW']),
        ),
      )
      .returning({ id: appointments.id });
    if (!updated[0]) throw Errors.notFound('Agendamento');
    return (await loadAppointmentDtos(tx, [id]))[0]!;
  });
}
