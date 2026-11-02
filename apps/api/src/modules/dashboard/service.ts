import type { DashboardSummaryDto } from '@barber-voice/contracts';
import {
  addDays,
  eachDate,
  startOfLocalDay,
  subtract,
  todayInZone,
  totalDuration,
  weekdayOf,
  workIntervalsForDate,
} from '@barber-voice/core';
import { appointments, customers, professionals, withTenant } from '@barber-voice/db';
import { and, count, eq, gte, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { ServiceContext } from '../../context';
import { loadAppointmentDtos, loadSchedulingData } from '../appointments/queries';

const ACTIVE = sql.raw(`('PENDING','CONFIRMED','COMPLETED','NO_SHOW')`);
const ts = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`;

/**
 * Indicadores reais do estabelecimento. Nada aqui é estimado: "faturamento registrado"
 * é a soma dos preços cadastrados dos atendimentos marcados como CONCLUÍDOS.
 */
export async function getDashboardSummary(ctx: ServiceContext, date?: string): Promise<DashboardSummaryDto> {
  const tz = ctx.tenant.timezone;
  const now = ctx.deps.clock();
  const today = date ?? todayInZone(tz, now.getTime());
  const weekStartDate = addDays(today, 1 - weekdayOf(today));
  const monthStartDate = `${today.slice(0, 8)}01`;
  const nextMonthDate = (() => {
    const [y, m] = today.split('-').map(Number) as [number, number];
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  })();

  const dayStart = startOfLocalDay(today, tz);
  const dayEnd = startOfLocalDay(addDays(today, 1), tz);
  const weekStart = startOfLocalDay(weekStartDate, tz);
  const weekEnd = startOfLocalDay(addDays(weekStartDate, 7), tz);
  const monthStart = startOfLocalDay(monthStartDate, tz);
  const monthEnd = startOfLocalDay(nextMonthDate, tz);
  const rangeStart = Math.min(weekStart, monthStart);
  const rangeEnd = Math.max(weekEnd, monthEnd);

  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [agg] = await tx
      .select({
        today: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${ts(dayStart)} AND ${appointments.startsAt} < ${ts(dayEnd)} AND ${appointments.status} IN ${ACTIVE})::int`,
        week: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${ts(weekStart)} AND ${appointments.startsAt} < ${ts(weekEnd)} AND ${appointments.status} IN ${ACTIVE})::int`,
        month: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${ts(monthStart)} AND ${appointments.startsAt} < ${ts(monthEnd)} AND ${appointments.status} IN ${ACTIVE})::int`,
        upcomingToday: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${ts(now.getTime())} AND ${appointments.startsAt} < ${ts(dayEnd)} AND ${appointments.status} IN ('PENDING','CONFIRMED'))::int`,
        cancellations: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${ts(monthStart)} AND ${appointments.startsAt} < ${ts(monthEnd)} AND ${appointments.status} = 'CANCELLED' AND COALESCE(${appointments.cancelReason}, '') <> 'Remarcado')::int`,
        noShows: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${ts(monthStart)} AND ${appointments.startsAt} < ${ts(monthEnd)} AND ${appointments.status} = 'NO_SHOW')::int`,
        revenue: sql<number>`COALESCE(sum(${appointments.totalPriceCents}) FILTER (WHERE ${appointments.startsAt} >= ${ts(monthStart)} AND ${appointments.startsAt} < ${ts(monthEnd)} AND ${appointments.status} = 'COMPLETED'), 0)::int`,
        estimated: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${ts(monthStart)} AND ${appointments.startsAt} < ${ts(monthEnd)} AND ${appointments.status} = 'COMPLETED' AND ${appointments.priceIsEstimate})::int`,
        weekBookedMin: sql<number>`COALESCE(sum(${appointments.totalDurationMin}) FILTER (WHERE ${appointments.startsAt} >= ${ts(weekStart)} AND ${appointments.startsAt} < ${ts(weekEnd)} AND ${appointments.status} IN ('PENDING','CONFIRMED','COMPLETED') AND NOT ${appointments.isOverbook}), 0)::int`,
      })
      .from(appointments)
      .where(
        and(gte(appointments.startsAt, new Date(rangeStart)), lt(appointments.startsAt, new Date(rangeEnd))),
      );

    const [custTotal] = await tx.select({ n: count() }).from(customers).where(isNull(customers.anonymizedAt));
    const [custNew] = await tx
      .select({ n: count() })
      .from(customers)
      .where(
        and(
          isNull(customers.anonymizedAt),
          gte(customers.createdAt, new Date(monthStart)),
          lt(customers.createdAt, new Date(monthEnd)),
        ),
      );
    const returning = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT a.customer_id)::int AS n
      FROM appointments a
      WHERE a.status = 'COMPLETED' AND a.starts_at >= ${ts(monthStart)} AND a.starts_at < ${ts(monthEnd)}
        AND EXISTS (
          SELECT 1 FROM appointments b
          WHERE b.customer_id = a.customer_id AND b.status = 'COMPLETED' AND b.starts_at < ${ts(monthStart)}
        )`);

    const topServices = await tx.execute<{ service_id: string; name: string; n: number }>(sql`
      SELECT i.service_id, i.service_name AS name, count(*)::int AS n
      FROM appointment_items i
      JOIN appointments a ON a.id = i.appointment_id
      WHERE a.starts_at >= ${ts(monthStart)} AND a.starts_at < ${ts(monthEnd)} AND a.status IN ('CONFIRMED','COMPLETED','PENDING')
      GROUP BY i.service_id, i.service_name
      ORDER BY n DESC, name ASC
      LIMIT 5`);

    const topProfessionals = await tx.execute<{ professional_id: string; name: string; n: number }>(sql`
      SELECT a.professional_id, p.name, count(*)::int AS n
      FROM appointments a
      JOIN professionals p ON p.id = a.professional_id
      WHERE a.starts_at >= ${ts(monthStart)} AND a.starts_at < ${ts(monthEnd)} AND a.status IN ('CONFIRMED','COMPLETED','PENDING')
      GROUP BY a.professional_id, p.name
      ORDER BY n DESC, p.name ASC
      LIMIT 5`);

    const busiest = await tx.execute<{ hour: number; n: number }>(sql`
      SELECT EXTRACT(HOUR FROM a.starts_at AT TIME ZONE ${tz})::int AS hour, count(*)::int AS n
      FROM appointments a
      WHERE a.starts_at >= ${ts(now.getTime() - 30 * 86_400_000)} AND a.starts_at < ${ts(now.getTime() + 30 * 86_400_000)}
        AND a.status IN ('PENDING','CONFIRMED','COMPLETED','NO_SHOW')
      GROUP BY hour
      ORDER BY hour`);

    // ocupação da semana: minutos agendados / minutos de jornada efetiva (sem folgas e fechamentos)
    const activeProfs = await tx
      .select({ id: professionals.id })
      .from(professionals)
      .where(and(eq(professionals.active, true), isNull(professionals.archivedAt)));
    const sched = await loadSchedulingData(tx, {
      professionalIds: activeProfs.map((p) => p.id),
      from: new Date(weekStart),
      to: new Date(weekEnd),
      now,
    });
    let availableMin = 0;
    for (const p of activeProfs) {
      const s = sched.byProfessional.get(p.id);
      for (const d of eachDate(weekStartDate, addDays(weekStartDate, 6))) {
        const work = workIntervalsForDate(d, s?.workingHours ?? null, sched.businessHours, tz);
        availableMin += totalDuration(subtract(work, [...sched.closures, ...(s?.timeOff ?? [])])) / 60_000;
      }
    }

    const todayRows = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          gte(appointments.startsAt, new Date(dayStart)),
          lt(appointments.startsAt, new Date(dayEnd)),
          notInArray(appointments.status, ['CANCELLED', 'EXPIRED', 'HELD']),
        ),
      )
      .orderBy(appointments.startsAt)
      .limit(200);
    const todayDtos = await loadAppointmentDtos(
      tx,
      todayRows.map((r) => r.id),
    );

    return {
      timezone: tz,
      date: today,
      appointments: {
        today: agg?.today ?? 0,
        week: agg?.week ?? 0,
        month: agg?.month ?? 0,
        upcomingToday: agg?.upcomingToday ?? 0,
      },
      customers: {
        total: custTotal?.n ?? 0,
        newThisMonth: custNew?.n ?? 0,
        returningThisMonth: returning.rows[0]?.n ?? 0,
      },
      revenue: {
        registeredThisMonthCents: agg?.revenue ?? 0,
        estimatedItemsThisMonth: agg?.estimated ?? 0,
      },
      quality: {
        cancellationsThisMonth: agg?.cancellations ?? 0,
        noShowsThisMonth: agg?.noShows ?? 0,
      },
      occupancy: {
        weekRate: availableMin > 0 ? Math.min(1, (agg?.weekBookedMin ?? 0) / availableMin) : null,
      },
      topServices: topServices.rows.map((r) => ({ serviceId: r.service_id, name: r.name, count: r.n })),
      topProfessionals: topProfessionals.rows.map((r) => ({
        professionalId: r.professional_id,
        name: r.name,
        count: r.n,
      })),
      busiestHours: busiest.rows.map((r) => ({ hour: r.hour, count: r.n })),
      // Telefonia e WhatsApp ainda não integrados (Fase 4): sem números fictícios.
      channels: { phone: null, whatsapp: null },
      todayAgenda: todayDtos.map((a) => ({
        id: a.id,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        status: a.status,
        customerName: a.customer.name,
        professionalName: a.professional.name,
        services: a.items.map((i) => i.serviceName),
      })),
    };
  });
}
