import type { AppointmentDto } from '@barber-voice/contracts';
import { type Interval, type WeeklyInterval, toWeeklyIntervals } from '@barber-voice/core';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  type Tx,
  appointmentItems,
  appointments,
  businessHours,
  closures,
  customers,
  professionalServices,
  professionalWorkingHours,
  professionals,
  services,
  timeOff,
} from '@barber-voice/db';
import { and, asc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { Errors } from '../../lib/errors';
import { iso } from '../../lib/serialize';

export async function loadAppointmentDtos(tx: Tx, ids: string[]): Promise<AppointmentDto[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      a: appointments,
      customerName: customers.name,
      customerPhone: customers.phone,
      professionalName: professionals.name,
      professionalColor: professionals.color,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(inArray(appointments.id, ids));
  const items = await tx
    .select()
    .from(appointmentItems)
    .where(inArray(appointmentItems.appointmentId, ids))
    .orderBy(asc(appointmentItems.sortOrder));

  const byId = new Map(
    rows.map((r) => [
      r.a.id,
      {
        id: r.a.id,
        status: r.a.status,
        startsAt: r.a.startsAt.toISOString(),
        endsAt: r.a.endsAt.toISOString(),
        blockedUntil: r.a.blockedUntil.toISOString(),
        totalDurationMin: r.a.totalDurationMin,
        totalPriceCents: r.a.totalPriceCents,
        priceIsEstimate: r.a.priceIsEstimate,
        source: r.a.source,
        isOverbook: r.a.isOverbook,
        notes: r.a.notes,
        customer: { id: r.a.customerId, name: r.customerName, phone: r.customerPhone },
        professional: { id: r.a.professionalId, name: r.professionalName, color: r.professionalColor },
        items: items
          .filter((i) => i.appointmentId === r.a.id)
          .map((i) => ({
            serviceId: i.serviceId,
            serviceName: i.serviceName,
            durationMin: i.durationMin,
            priceCents: i.priceCents,
            priceType: i.priceType,
          })),
        cancelledAt: iso(r.a.cancelledAt),
        cancelReason: r.a.cancelReason,
        rescheduledFromId: r.a.rescheduledFromId,
        createdAt: r.a.createdAt.toISOString(),
      } satisfies AppointmentDto,
    ]),
  );
  return ids.map((id) => byId.get(id)).filter((x): x is AppointmentDto => Boolean(x));
}

export type ServiceRow = typeof services.$inferSelect;

/** Serviços ativos na ordem pedida. Falha se algum não existir ou estiver inativo. */
export async function resolveServices(
  tx: Tx,
  serviceIds: string[],
  opts: { forAi?: boolean } = {},
): Promise<ServiceRow[]> {
  const unique = [...new Set(serviceIds)];
  const rows = await tx
    .select()
    .from(services)
    .where(and(inArray(services.id, unique), isNull(services.archivedAt), eq(services.active, true)));
  if (rows.length !== unique.length) {
    throw Errors.unprocessable('SERVICE_UNAVAILABLE', 'Um ou mais serviços não existem ou estão inativos.');
  }
  if (opts.forAi && rows.some((r) => !r.bookableByAi)) {
    throw Errors.unprocessable(
      'SERVICE_NOT_BOOKABLE_BY_AI',
      'Este serviço precisa ser agendado com a equipe.',
    );
  }
  const map = new Map(rows.map((r) => [r.id, r]));
  return unique.map((id) => map.get(id)!);
}

export interface EligibleProfessional {
  id: string;
  name: string;
  sortOrder: number;
  usesBusinessHours: boolean;
  bookableByAi: boolean;
  durationMin: number;
  bufferAfterMin: number;
  totalPriceCents: number | null;
  priceIsEstimate: boolean;
  items: {
    serviceId: string;
    serviceName: string;
    durationMin: number;
    priceCents: number | null;
    priceType: ServiceRow['priceType'];
  }[];
}

/**
 * Profissionais ativos que realizam TODOS os serviços pedidos, com duração e preço
 * calculados (sobrescritas por profissional têm prioridade sobre o padrão do serviço).
 */
export async function eligibleProfessionals(
  tx: Tx,
  svc: ServiceRow[],
  onlyProfessionalId?: string,
  opts: { forAi?: boolean } = {},
): Promise<EligibleProfessional[]> {
  const serviceIds = svc.map((s) => s.id);
  const links = await tx
    .select({
      professionalId: professionalServices.professionalId,
      serviceId: professionalServices.serviceId,
      durationMin: professionalServices.durationMin,
      priceCents: professionalServices.priceCents,
      name: professionals.name,
      sortOrder: professionals.sortOrder,
      usesBusinessHours: professionals.usesBusinessHours,
      bookableByAi: professionals.bookableByAi,
    })
    .from(professionalServices)
    .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
    .where(
      and(
        inArray(professionalServices.serviceId, serviceIds),
        eq(professionals.active, true),
        isNull(professionals.archivedAt),
        onlyProfessionalId ? eq(professionals.id, onlyProfessionalId) : undefined,
        opts.forAi ? eq(professionals.bookableByAi, true) : undefined,
      ),
    );

  const grouped = new Map<string, typeof links>();
  for (const l of links) {
    const list = grouped.get(l.professionalId);
    if (list) list.push(l);
    else grouped.set(l.professionalId, [l]);
  }

  const out: EligibleProfessional[] = [];
  for (const [professionalId, list] of grouped) {
    if (new Set(list.map((l) => l.serviceId)).size !== serviceIds.length) continue;
    const first = list[0]!;
    const items = svc.map((s) => {
      const link = list.find((l) => l.serviceId === s.id)!;
      const priceCents = s.priceType === 'ON_REQUEST' ? null : (link.priceCents ?? s.priceCents);
      return {
        serviceId: s.id,
        serviceName: s.name,
        durationMin: link.durationMin ?? s.durationMin,
        priceCents,
        priceType: s.priceType,
      };
    });
    const anyOnRequest = items.some((i) => i.priceType === 'ON_REQUEST' || i.priceCents === null);
    out.push({
      id: professionalId,
      name: first.name,
      sortOrder: first.sortOrder,
      usesBusinessHours: first.usesBusinessHours,
      bookableByAi: first.bookableByAi,
      durationMin: items.reduce((acc, i) => acc + i.durationMin, 0),
      bufferAfterMin: Math.max(0, ...svc.map((s) => s.bufferAfterMin)),
      totalPriceCents: anyOnRequest ? null : items.reduce((acc, i) => acc + (i.priceCents ?? 0), 0),
      priceIsEstimate: anyOnRequest || items.some((i) => i.priceType === 'STARTING_AT'),
      items,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export interface ProfessionalScheduleData {
  workingHours: WeeklyInterval[] | null;
  timeOff: Interval[];
  busy: Interval[];
}

export interface SchedulingData {
  businessHours: WeeklyInterval[];
  closures: Interval[];
  byProfessional: Map<string, ProfessionalScheduleData>;
}

/**
 * Carrega tudo o que o motor de disponibilidade precisa, já no formato do core.
 * Reservas temporárias (HELD) vencidas não ocupam a agenda.
 */
export async function loadSchedulingData(
  tx: Tx,
  params: { professionalIds: string[]; from: Date; to: Date; now: Date; excludeAppointmentId?: string },
): Promise<SchedulingData> {
  const { professionalIds, from, to, now } = params;
  const bh = await tx.select().from(businessHours);
  const cl = await tx
    .select({ startsAt: closures.startsAt, endsAt: closures.endsAt })
    .from(closures)
    .where(and(lt(closures.startsAt, to), gt(closures.endsAt, from)));

  const byProfessional = new Map<string, ProfessionalScheduleData>();
  if (professionalIds.length) {
    const profs = await tx
      .select({ id: professionals.id, usesBusinessHours: professionals.usesBusinessHours })
      .from(professionals)
      .where(inArray(professionals.id, professionalIds));
    const wh = await tx
      .select()
      .from(professionalWorkingHours)
      .where(inArray(professionalWorkingHours.professionalId, professionalIds));
    const off = await tx
      .select({ professionalId: timeOff.professionalId, startsAt: timeOff.startsAt, endsAt: timeOff.endsAt })
      .from(timeOff)
      .where(
        and(
          inArray(timeOff.professionalId, professionalIds),
          lt(timeOff.startsAt, to),
          gt(timeOff.endsAt, from),
        ),
      );
    const busy = await tx
      .select({
        professionalId: appointments.professionalId,
        startsAt: appointments.startsAt,
        blockedUntil: appointments.blockedUntil,
      })
      .from(appointments)
      .where(
        and(
          inArray(appointments.professionalId, professionalIds),
          inArray(appointments.status, [...BLOCKING_APPOINTMENT_STATUSES]),
          or(ne(appointments.status, 'HELD'), gt(appointments.holdExpiresAt, now)),
          lt(appointments.startsAt, to),
          gt(appointments.blockedUntil, from),
          params.excludeAppointmentId ? ne(appointments.id, params.excludeAppointmentId) : undefined,
        ),
      );

    for (const p of profs) {
      byProfessional.set(p.id, {
        workingHours: p.usesBusinessHours
          ? null
          : toWeeklyIntervals(wh.filter((w) => w.professionalId === p.id)),
        timeOff: off
          .filter((o) => o.professionalId === p.id)
          .map((o) => ({ start: o.startsAt.getTime(), end: o.endsAt.getTime() })),
        busy: busy
          .filter((b) => b.professionalId === p.id)
          .map((b) => ({ start: b.startsAt.getTime(), end: b.blockedUntil.getTime() })),
      });
    }
  }

  return {
    businessHours: toWeeklyIntervals(bh),
    closures: cl.map((c) => ({ start: c.startsAt.getTime(), end: c.endsAt.getTime() })),
    byProfessional,
  };
}

/** Marca como EXPIRED as reservas temporárias vencidas do profissional (libera a constraint). */
export async function expireStaleHolds(tx: Tx, professionalId: string, now: Date): Promise<void> {
  await tx
    .update(appointments)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(
      and(
        eq(appointments.professionalId, professionalId),
        eq(appointments.status, 'HELD'),
        sql`${appointments.holdExpiresAt} <= ${now.toISOString()}::timestamptz`,
      ),
    );
}
