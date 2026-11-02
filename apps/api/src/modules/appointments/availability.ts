import type { AvailabilityResponse } from '@barber-voice/contracts';
import {
  type ProfessionalScheduleInput,
  addDays,
  computeAvailability,
  diffDays,
  groupSlotsByStart,
  instantToLocal,
  rankProfessionals,
  startOfLocalDay,
} from '@barber-voice/core';
import { withTenant } from '@barber-voice/db';
import type { ServiceContext } from '../../context';
import { Errors } from '../../lib/errors';
import { eligibleProfessionals, loadSchedulingData, resolveServices } from './queries';

const MAX_RANGE_DAYS = 31;
const LOOKAHEAD_MS = 4 * 3_600_000;

export interface AvailabilityQuery {
  serviceIds: string[];
  professionalId?: string | undefined;
  from: string;
  to: string;
  timeFrom?: string | undefined;
  timeTo?: string | undefined;
  /** Profissional preferido do cliente (ordenação), usado pela recepcionista. */
  preferredProfessionalId?: string | null | undefined;
  /** Canal de IA: respeita "agendável pela IA" e a política do estabelecimento. */
  forAi?: boolean;
  /** Remarcação: o próprio agendamento não ocupa a agenda nesta consulta. */
  excludeAppointmentId?: string | undefined;
}

/**
 * Horários livres reais, calculados a partir da agenda no banco. Para o painel, a
 * antecedência mínima e o limite de dias valem como para o cliente (consistência
 * com o que a IA ofereceria); reservas manuais podem ignorá-los na criação.
 */
export async function getAvailability(
  ctx: ServiceContext,
  q: AvailabilityQuery,
): Promise<AvailabilityResponse> {
  if (diffDays(q.from, q.to) > MAX_RANGE_DAYS) {
    throw Errors.unprocessable('RANGE_TOO_LARGE', `Consulte no máximo ${MAX_RANGE_DAYS} dias por vez.`);
  }
  const tz = ctx.tenant.timezone;
  const now = ctx.deps.clock();

  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const svc = await resolveServices(tx, q.serviceIds, { forAi: q.forAi ?? false });
    const eligible = await eligibleProfessionals(tx, svc, q.professionalId, { forAi: q.forAi ?? false });
    if (q.professionalId && eligible.length === 0) {
      throw Errors.unprocessable(
        'PROFESSIONAL_CANNOT_PERFORM',
        'Este profissional não realiza o(s) serviço(s) escolhido(s).',
      );
    }
    const from = new Date(startOfLocalDay(q.from, tz));
    const to = new Date(startOfLocalDay(addDays(q.to, 1), tz) + LOOKAHEAD_MS);
    const data = await loadSchedulingData(tx, {
      professionalIds: eligible.map((p) => p.id),
      from,
      to,
      now,
      ...(q.excludeAppointmentId ? { excludeAppointmentId: q.excludeAppointmentId } : {}),
    });

    const inputs: ProfessionalScheduleInput[] = eligible.map((p) => {
      const sched = data.byProfessional.get(p.id) ?? { workingHours: null, timeOff: [], busy: [] };
      return {
        professionalId: p.id,
        workingHours: sched.workingHours,
        timeOff: sched.timeOff,
        busy: sched.busy,
        durationMin: p.durationMin,
        bufferAfterMin: p.bufferAfterMin,
      };
    });

    const slots = computeAvailability({
      timezone: tz,
      slotIntervalMin: ctx.tenant.slotIntervalMin,
      minNoticeMin: ctx.tenant.minBookingNoticeMin,
      maxDaysAhead: ctx.tenant.maxBookingDaysAhead,
      fromDate: q.from,
      toDate: q.to,
      businessHours: data.businessHours,
      closures: data.closures,
      professionals: inputs,
      now: now.getTime(),
      timeWindow: q.timeFrom || q.timeTo ? { from: q.timeFrom, to: q.timeTo } : undefined,
    });

    // carga do dia por profissional (minutos ocupados) para distribuir melhor a agenda
    const load = new Map<string, number>();
    for (const input of inputs) {
      for (const b of input.busy) {
        const key = `${input.professionalId}|${instantToLocal(b.start, tz).date}`;
        load.set(key, (load.get(key) ?? 0) + (b.end - b.start) / 60_000);
      }
    }

    const durationByProfessional = Object.fromEntries(eligible.map((p) => [p.id, p.durationMin]));
    return {
      timezone: tz,
      durationByProfessional,
      slots: groupSlotsByStart(slots).map((g) => {
        const date = instantToLocal(g.start, tz).date;
        const ids = g.options.map((o) => o.professionalId);
        const dayLoad = Object.fromEntries(ids.map((id) => [id, load.get(`${id}|${date}`) ?? 0]));
        const ranked = rankProfessionals(ids, dayLoad, q.preferredProfessionalId);
        const best = g.options.find((o) => o.professionalId === ranked[0])!;
        return {
          start: new Date(g.start).toISOString(),
          end: new Date(best.end).toISOString(),
          professionalIds: ranked,
        };
      }),
    };
  });
}
