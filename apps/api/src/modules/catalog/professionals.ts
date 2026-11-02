import type { ProfessionalDto, ProfessionalInput, WeeklyIntervalDto } from '@barber-voice/contracts';
import { professionalUpdateSchema } from '@barber-voice/contracts';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  type Tx,
  appointments,
  lockProfessionalSchedule,
  professionalServices,
  professionalWorkingHours,
  professionals,
  services,
  withTenant,
} from '@barber-voice/db';
import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { hhmm } from '../../lib/serialize';

type ProfessionalRow = typeof professionals.$inferSelect;

async function assembleProfessionals(tx: Tx, rows: ProfessionalRow[]): Promise<ProfessionalDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const hours = await tx
    .select()
    .from(professionalWorkingHours)
    .where(inArray(professionalWorkingHours.professionalId, ids))
    .orderBy(asc(professionalWorkingHours.weekday), asc(professionalWorkingHours.startTime));
  const links = await tx
    .select({
      professionalId: professionalServices.professionalId,
      serviceId: professionalServices.serviceId,
      durationMin: professionalServices.durationMin,
      priceCents: professionalServices.priceCents,
    })
    .from(professionalServices)
    .innerJoin(services, eq(services.id, professionalServices.serviceId))
    .where(and(inArray(professionalServices.professionalId, ids), isNull(services.archivedAt)));

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    bio: p.bio,
    email: p.email,
    phone: p.phone,
    color: p.color,
    active: p.active,
    bookableByAi: p.bookableByAi,
    sortOrder: p.sortOrder,
    usesBusinessHours: p.usesBusinessHours,
    workingHours: p.usesBusinessHours
      ? null
      : hours
          .filter((h) => h.professionalId === p.id)
          .map((h) => ({ weekday: h.weekday, start: hhmm(h.startTime), end: hhmm(h.endTime) })),
    services: links
      .filter((l) => l.professionalId === p.id)
      .map((l) => ({ serviceId: l.serviceId, durationMin: l.durationMin, priceCents: l.priceCents })),
  }));
}

async function assertServicesExist(tx: Tx, serviceIds: string[]) {
  if (serviceIds.length === 0) return;
  const unique = [...new Set(serviceIds)];
  const found = await tx
    .select({ id: services.id })
    .from(services)
    .where(and(inArray(services.id, unique), isNull(services.archivedAt)));
  if (found.length !== unique.length) {
    throw Errors.unprocessable('INVALID_SERVICES', 'Um ou mais serviços informados não existem.');
  }
}

async function replaceWorkingHours(
  tx: Tx,
  tenantId: string,
  professionalId: string,
  hours: WeeklyIntervalDto[] | null,
) {
  await tx
    .delete(professionalWorkingHours)
    .where(eq(professionalWorkingHours.professionalId, professionalId));
  if (hours && hours.length) {
    await tx
      .insert(professionalWorkingHours)
      .values(
        hours.map((h) => ({
          tenantId,
          professionalId,
          weekday: h.weekday,
          startTime: h.start,
          endTime: h.end,
        })),
      );
  }
  await tx
    .update(professionals)
    .set({ usesBusinessHours: hours === null })
    .where(eq(professionals.id, professionalId));
}

async function loadOne(tx: Tx, professionalId: string): Promise<ProfessionalRow> {
  const [p] = await tx
    .select()
    .from(professionals)
    .where(and(eq(professionals.id, professionalId), isNull(professionals.archivedAt)))
    .limit(1);
  if (!p) throw Errors.notFound('Profissional');
  return p;
}

export async function listProfessionals(ctx: ServiceContext): Promise<ProfessionalDto[]> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(professionals)
      .where(isNull(professionals.archivedAt))
      .orderBy(asc(professionals.sortOrder), asc(professionals.name));
    return assembleProfessionals(tx, rows);
  });
}

export async function getProfessional(ctx: ServiceContext, professionalId: string): Promise<ProfessionalDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const row = await loadOne(tx, professionalId);
    return (await assembleProfessionals(tx, [row]))[0]!;
  });
}

export async function createProfessional(
  ctx: ServiceContext,
  input: ProfessionalInput,
): Promise<ProfessionalDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    await assertServicesExist(tx, input.serviceIds);
    const [p] = await tx
      .insert(professionals)
      .values({
        tenantId: ctx.tenant.id,
        name: input.name,
        bio: input.bio ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        color: input.color ?? null,
        active: input.active,
        bookableByAi: input.bookableByAi,
        sortOrder: input.sortOrder,
        usesBusinessHours: !input.workingHours,
      })
      .returning();
    const id = p!.id;
    if (input.serviceIds.length) {
      await tx
        .insert(professionalServices)
        .values(
          [...new Set(input.serviceIds)].map((serviceId) => ({
            tenantId: ctx.tenant.id,
            professionalId: id,
            serviceId,
          })),
        );
    }
    if (input.workingHours) await replaceWorkingHours(tx, ctx.tenant.id, id, input.workingHours);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'professional.created',
      entityType: 'professional',
      entityId: id,
      ...ctx.meta,
    });
    return (await assembleProfessionals(tx, [await loadOne(tx, id)]))[0]!;
  });
}

export async function updateProfessional(
  ctx: ServiceContext,
  professionalId: string,
  input: z.output<typeof professionalUpdateSchema>,
): Promise<ProfessionalDto> {
  const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    await loadOne(tx, professionalId);
    if (Object.keys(fields).length) {
      await tx.update(professionals).set(fields).where(eq(professionals.id, professionalId));
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.actor.userId,
        action: 'professional.updated',
        entityType: 'professional',
        entityId: professionalId,
        metadata: { fields: Object.keys(fields) },
        ...ctx.meta,
      });
    }
    return (await assembleProfessionals(tx, [await loadOne(tx, professionalId)]))[0]!;
  });
}

export async function setProfessionalSchedule(
  ctx: ServiceContext,
  professionalId: string,
  workingHours: WeeklyIntervalDto[] | null,
): Promise<ProfessionalDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    await loadOne(tx, professionalId);
    await lockProfessionalSchedule(tx, professionalId);
    await replaceWorkingHours(tx, ctx.tenant.id, professionalId, workingHours);
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'professional.schedule_updated',
      entityType: 'professional',
      entityId: professionalId,
      metadata: { inheritsBusinessHours: workingHours === null, intervals: workingHours?.length ?? 0 },
      ...ctx.meta,
    });
    return (await assembleProfessionals(tx, [await loadOne(tx, professionalId)]))[0]!;
  });
}

export async function setProfessionalServices(
  ctx: ServiceContext,
  professionalId: string,
  list: {
    serviceId: string;
    durationMin?: number | null | undefined;
    priceCents?: number | null | undefined;
  }[],
): Promise<ProfessionalDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    await loadOne(tx, professionalId);
    await assertServicesExist(
      tx,
      list.map((l) => l.serviceId),
    );
    await tx.delete(professionalServices).where(eq(professionalServices.professionalId, professionalId));
    const dedup = new Map(list.map((l) => [l.serviceId, l]));
    if (dedup.size) {
      await tx.insert(professionalServices).values(
        [...dedup.values()].map((l) => ({
          tenantId: ctx.tenant.id,
          professionalId,
          serviceId: l.serviceId,
          durationMin: l.durationMin ?? null,
          priceCents: l.priceCents ?? null,
        })),
      );
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'professional.services_updated',
      entityType: 'professional',
      entityId: professionalId,
      metadata: { services: dedup.size },
      ...ctx.meta,
    });
    return (await assembleProfessionals(tx, [await loadOne(tx, professionalId)]))[0]!;
  });
}

export async function archiveProfessional(ctx: ServiceContext, professionalId: string): Promise<void> {
  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    await loadOne(tx, professionalId);
    const [upcoming] = await tx
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.professionalId, professionalId),
          inArray(appointments.status, [...BLOCKING_APPOINTMENT_STATUSES]),
          gt(appointments.startsAt, ctx.deps.clock()),
        ),
      );
    if ((upcoming?.n ?? 0) > 0) {
      throw Errors.conflict(
        'PROFESSIONAL_HAS_UPCOMING_APPOINTMENTS',
        'Este profissional tem agendamentos futuros. Remarque ou cancele antes de removê-lo.',
        { upcoming: upcoming!.n },
      );
    }
    await tx
      .update(professionals)
      .set({ archivedAt: ctx.deps.clock(), active: false })
      .where(eq(professionals.id, professionalId));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'professional.archived',
      entityType: 'professional',
      entityId: professionalId,
      ...ctx.meta,
    });
  });
}
