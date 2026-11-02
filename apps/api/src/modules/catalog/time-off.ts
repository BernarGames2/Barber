import type { TimeOffDto } from '@barber-voice/contracts';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  appointments,
  customers,
  lockProfessionalSchedule,
  professionals,
  timeOff,
  withTenant,
} from '@barber-voice/db';
import { and, asc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import type { ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';

type TimeOffRow = typeof timeOff.$inferSelect;

const toDto = (t: TimeOffRow): TimeOffDto => ({
  id: t.id,
  professionalId: t.professionalId,
  kind: t.kind,
  reason: t.reason,
  startsAt: t.startsAt.toISOString(),
  endsAt: t.endsAt.toISOString(),
});

export async function listTimeOff(
  ctx: ServiceContext,
  filter: { from: Date; to: Date; professionalId?: string | undefined },
): Promise<TimeOffDto[]> {
  const rows = await withTenant(ctx.deps.db, ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(timeOff)
      .where(
        and(
          lt(timeOff.startsAt, filter.to),
          gt(timeOff.endsAt, filter.from),
          filter.professionalId ? eq(timeOff.professionalId, filter.professionalId) : undefined,
        ),
      )
      .orderBy(asc(timeOff.startsAt))
      .limit(500),
  );
  return rows.map(toDto);
}

/**
 * Cria folga/bloqueio. Se houver agendamentos no período, recusa com a lista deles
 * (o gestor decide remarcar) — a menos que `force` seja usado conscientemente.
 * O lock por profissional serializa esta operação com reservas simultâneas.
 */
export async function createTimeOff(
  ctx: ServiceContext,
  input: { professionalId: string; kind: TimeOffRow['kind']; reason?: string | null | undefined; startsAt: string; endsAt: string },
  force: boolean,
): Promise<TimeOffDto> {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [prof] = await tx
      .select({ id: professionals.id })
      .from(professionals)
      .where(and(eq(professionals.id, input.professionalId), isNull(professionals.archivedAt)))
      .limit(1);
    if (!prof) throw Errors.notFound('Profissional');
    await lockProfessionalSchedule(tx, input.professionalId);

    const conflicts = await tx
      .select({ id: appointments.id, startsAt: appointments.startsAt, customerName: customers.name })
      .from(appointments)
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .where(
        and(
          eq(appointments.professionalId, input.professionalId),
          inArray(appointments.status, [...BLOCKING_APPOINTMENT_STATUSES]),
          lt(appointments.startsAt, endsAt),
          gt(appointments.blockedUntil, startsAt),
        ),
      )
      .orderBy(asc(appointments.startsAt));
    if (conflicts.length && !force) {
      throw Errors.conflict('TIME_OFF_CONFLICTS', 'Há agendamentos neste período. Remarque-os ou confirme o bloqueio mesmo assim.', {
        appointments: conflicts.map((c) => ({ id: c.id, startsAt: c.startsAt.toISOString(), customerName: c.customerName })),
      });
    }

    const [row] = await tx
      .insert(timeOff)
      .values({
        tenantId: ctx.tenant.id,
        professionalId: input.professionalId,
        kind: input.kind,
        reason: input.reason ?? null,
        startsAt,
        endsAt,
        createdByUserId: ctx.actor.userId,
      })
      .returning();
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'time_off.created',
      entityType: 'time_off',
      entityId: row!.id,
      metadata: { professionalId: input.professionalId, forcedOverAppointments: conflicts.length },
      ...ctx.meta,
    });
    return toDto(row!);
  });
}

export async function deleteTimeOff(ctx: ServiceContext, id: string): Promise<void> {
  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const deleted = await tx.delete(timeOff).where(eq(timeOff.id, id)).returning({ id: timeOff.id });
    if (!deleted[0]) throw Errors.notFound('Bloqueio');
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'time_off.deleted',
      entityType: 'time_off',
      entityId: id,
      ...ctx.meta,
    });
  });
}
