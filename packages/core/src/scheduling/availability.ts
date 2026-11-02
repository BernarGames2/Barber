import {
  type Interval,
  MINUTE_MS,
  containsInterval,
  intersect,
  normalize,
  overlaps,
  subtract,
} from '../time/interval';
import {
  type IsoWeekday,
  addDays,
  eachDate,
  instantToLocal,
  localToInstant,
  minutesToTime,
  timeToMinutes,
  todayInZone,
  weekdayOf,
} from '../time/zone';

/**
 * Motor de disponibilidade do Barber Voice.
 *
 * Regra de ouro: este módulo é a ÚNICA fonte de verdade sobre "este horário está livre?".
 * A recepcionista de IA, o painel e a validação de reservas usam as mesmas funções.
 * A garantia final contra reservas simultâneas fica no banco (exclusion constraint),
 * mas a semântica aqui é idêntica: um agendamento ocupa [início, fim + intervalo de limpeza).
 */

/** Faixa semanal em hora local. `start` < `end`, ambos no mesmo dia (sem virada de meia-noite). */
export interface WeeklyInterval {
  weekday: IsoWeekday;
  start: string;
  end: string;
}

export interface ProfessionalScheduleInput {
  professionalId: string;
  /** Jornada semanal própria. `null` = herda o horário de funcionamento do estabelecimento. */
  workingHours: readonly WeeklyInterval[] | null;
  /** Folgas, férias e bloqueios do profissional. */
  timeOff: readonly Interval[];
  /** Agendamentos ativos do profissional, como [startsAt, blockedUntil). */
  busy: readonly Interval[];
  /** Duração total dos serviços solicitados com este profissional. */
  durationMin: number;
  /** Intervalo de limpeza/preparo após o atendimento. */
  bufferAfterMin: number;
}

export interface SchedulingPolicy {
  timezone: string;
  /** Grade de horários oferecidos (ex.: 15 ou 30 minutos). */
  slotIntervalMin: number;
  /** Antecedência mínima para reservar. */
  minNoticeMin: number;
  /** Até quantos dias à frente é possível reservar. */
  maxDaysAhead: number;
}

export interface AvailabilityRequest extends SchedulingPolicy {
  fromDate: string;
  toDate: string;
  businessHours: readonly WeeklyInterval[];
  /** Fechamentos do estabelecimento inteiro (feriados, eventos). */
  closures: readonly Interval[];
  professionals: readonly ProfessionalScheduleInput[];
  now: number;
  /** Filtra pelo horário local de INÍCIO, inclusive nas duas pontas ('HH:mm'). */
  timeWindow?: { from?: string | undefined; to?: string | undefined } | undefined;
  /**
   * Também oferece o horário imediatamente após um atendimento, mesmo fora da grade
   * (ex.: 10:40 depois de um serviço de 40 min). Reduz buracos na agenda. Padrão: true.
   */
  includeBackToBack?: boolean;
}

export interface ProfessionalSlot {
  professionalId: string;
  start: number;
  end: number;
  blockedUntil: number;
}

const FIVE_MIN = 5 * MINUTE_MS;

function dayIntervals(date: string, weekly: readonly WeeklyInterval[], zone: string): Interval[] {
  const wd = weekdayOf(date);
  return normalize(
    weekly
      .filter((w) => w.weekday === wd)
      .map((w) => ({ start: localToInstant(date, w.start, zone), end: localToInstant(date, w.end, zone) })),
  );
}

/** Jornada efetiva do profissional na data = jornada própria ∩ horário de funcionamento. */
export function workIntervalsForDate(
  date: string,
  professionalHours: readonly WeeklyInterval[] | null,
  businessHours: readonly WeeklyInterval[],
  zone: string,
): Interval[] {
  const biz = dayIntervals(date, businessHours, zone);
  if (!professionalHours) return biz;
  return intersect(dayIntervals(date, professionalHours, zone), biz);
}

function gridForDate(date: string, slotIntervalMin: number, zone: string): number[] {
  const out: number[] = [];
  for (let m = 0; m < 24 * 60; m += slotIntervalMin) {
    out.push(localToInstant(date, minutesToTime(m), zone));
  }
  return out;
}

function validatePolicy(p: SchedulingPolicy) {
  if (!Number.isInteger(p.slotIntervalMin) || p.slotIntervalMin < 5 || p.slotIntervalMin > 240) {
    throw new RangeError('slotIntervalMin deve estar entre 5 e 240');
  }
  if (p.minNoticeMin < 0 || p.maxDaysAhead < 0) throw new RangeError('Política de agenda inválida');
}

/**
 * Calcula os horários livres por profissional no período solicitado.
 * Resultado ordenado por início e, em seguida, pela ordem dos profissionais na entrada.
 */
export function computeAvailability(req: AvailabilityRequest): ProfessionalSlot[] {
  validatePolicy(req);
  const zone = req.timezone;
  const today = todayInZone(zone, req.now);
  const lastBookableDate = addDays(today, req.maxDaysAhead);
  const from = req.fromDate < today ? today : req.fromDate;
  const to = req.toDate > lastBookableDate ? lastBookableDate : req.toDate;
  if (from > to) return [];

  const earliest = req.now + req.minNoticeMin * MINUTE_MS;
  const backToBack = req.includeBackToBack ?? true;
  const order = new Map(req.professionals.map((p, i) => [p.professionalId, i]));
  const out: ProfessionalSlot[] = [];

  for (const date of eachDate(from, to)) {
    const grid = gridForDate(date, req.slotIntervalMin, zone);
    const winFrom = req.timeWindow?.from ? localToInstant(date, req.timeWindow.from, zone) : -Infinity;
    const winTo = req.timeWindow?.to ? localToInstant(date, req.timeWindow.to, zone) : Infinity;

    for (const prof of req.professionals) {
      if (prof.durationMin <= 0) continue;
      const work = workIntervalsForDate(date, prof.workingHours, req.businessHours, zone);
      if (work.length === 0) continue;

      const durMs = prof.durationMin * MINUTE_MS;
      const bufMs = Math.max(0, prof.bufferAfterMin) * MINUTE_MS;
      // Agendamentos existentes são "esticados" para trás pelo buffer do NOVO atendimento,
      // garantindo início + duração + buffer <= início do próximo agendamento.
      const blocks: Interval[] = [
        ...req.closures,
        ...prof.timeOff,
        ...prof.busy.map((b) => ({ start: b.start - bufMs, end: b.end })),
      ];
      const free = subtract(work, blocks);

      for (const f of free) {
        const starts = new Set<number>();
        for (const g of grid) {
          if (g >= f.start && g + durMs <= f.end) starts.add(g);
        }
        if (backToBack) {
          const s = Math.ceil(f.start / FIVE_MIN) * FIVE_MIN;
          if (s + durMs <= f.end) starts.add(s);
        }
        for (const s of starts) {
          if (s < earliest) continue;
          if (s < winFrom || s > winTo) continue;
          out.push({
            professionalId: prof.professionalId,
            start: s,
            end: s + durMs,
            blockedUntil: s + durMs + bufMs,
          });
        }
      }
    }
  }

  return out.sort(
    (a, b) => a.start - b.start || (order.get(a.professionalId) ?? 0) - (order.get(b.professionalId) ?? 0),
  );
}

export type SlotRejectionReason =
  | 'INVALID_DURATION'
  | 'IN_PAST'
  | 'TOO_SOON'
  | 'TOO_FAR'
  | 'CROSSES_MIDNIGHT'
  | 'CLOSED'
  | 'OUTSIDE_WORKING_HOURS'
  | 'TIME_OFF'
  | 'CONFLICT';

export const SLOT_REJECTION_MESSAGES: Record<SlotRejectionReason, string> = {
  INVALID_DURATION: 'Duração do atendimento inválida.',
  IN_PAST: 'Este horário já passou.',
  TOO_SOON: 'Este horário não respeita a antecedência mínima para agendamento.',
  TOO_FAR: 'Este horário está além do limite de dias para agendamento.',
  CROSSES_MIDNIGHT: 'O atendimento não pode atravessar a meia-noite.',
  CLOSED: 'O estabelecimento está fechado neste horário.',
  OUTSIDE_WORKING_HOURS: 'O profissional não atende neste horário.',
  TIME_OFF: 'O profissional está de folga ou com horário bloqueado.',
  CONFLICT: 'Este horário já está ocupado.',
};

export interface SlotValidationRequest extends SchedulingPolicy {
  businessHours: readonly WeeklyInterval[];
  closures: readonly Interval[];
  professional: ProfessionalScheduleInput;
  start: number;
  now: number;
  /** Encaixe deliberado feito por um funcionário. A IA NUNCA usa. */
  ignoreConflicts?: boolean;
  /** Atendimento fora do horário, decidido por gestor. A IA NUNCA usa. */
  ignoreWorkingHours?: boolean;
  /** Registro retroativo/imediato pelo painel (ex.: cliente que chegou sem horário). */
  ignoreNotice?: boolean;
}

export type SlotValidationResult =
  | { ok: true; end: number; blockedUntil: number }
  | { ok: false; reason: SlotRejectionReason; message: string };

function reject(reason: SlotRejectionReason): SlotValidationResult {
  return { ok: false, reason, message: SLOT_REJECTION_MESSAGES[reason] };
}

/**
 * Valida se um horário específico pode ser reservado. Mesma semântica de `computeAvailability`,
 * mas aceita horários fora da grade (o painel pode marcar 10:10, por exemplo).
 */
export function validateSlot(req: SlotValidationRequest): SlotValidationResult {
  validatePolicy(req);
  const zone = req.timezone;
  const prof = req.professional;
  if (!Number.isInteger(prof.durationMin) || prof.durationMin <= 0 || prof.durationMin > 12 * 60) {
    return reject('INVALID_DURATION');
  }
  const start = req.start;
  const end = start + prof.durationMin * MINUTE_MS;
  const blockedUntil = end + Math.max(0, prof.bufferAfterMin) * MINUTE_MS;

  if (!req.ignoreNotice) {
    if (start < req.now) return reject('IN_PAST');
    if (start < req.now + req.minNoticeMin * MINUTE_MS) return reject('TOO_SOON');
    const today = todayInZone(zone, req.now);
    if (instantToLocal(start, zone).date > addDays(today, req.maxDaysAhead)) return reject('TOO_FAR');
  }

  const startLocal = instantToLocal(start, zone);
  const endLocal = instantToLocal(end - 1, zone);
  if (startLocal.date !== endLocal.date) return reject('CROSSES_MIDNIGHT');

  const target = { start, end };
  if (!req.ignoreWorkingHours) {
    const biz = dayIntervals(startLocal.date, req.businessHours, zone);
    if (biz.length === 0) return reject('CLOSED');
    if (req.closures.some((c) => overlaps(c, target))) return reject('CLOSED');
    if (!containsInterval(biz, target)) return reject('CLOSED');
    const work = workIntervalsForDate(startLocal.date, prof.workingHours, req.businessHours, zone);
    if (!containsInterval(work, target)) return reject('OUTSIDE_WORKING_HOURS');
    if (prof.timeOff.some((t) => overlaps(t, target))) return reject('TIME_OFF');
  }

  if (!req.ignoreConflicts) {
    const occupied = { start, end: blockedUntil };
    if (prof.busy.some((b) => overlaps(b, occupied))) return reject('CONFLICT');
  }

  return { ok: true, end, blockedUntil };
}

export interface GroupedSlot {
  start: number;
  options: ProfessionalSlot[];
}

/** Agrupa horários de vários profissionais pelo mesmo início ("qualquer profissional"). */
export function groupSlotsByStart(slots: readonly ProfessionalSlot[]): GroupedSlot[] {
  const map = new Map<number, ProfessionalSlot[]>();
  for (const s of slots) {
    const list = map.get(s.start);
    if (list) list.push(s);
    else map.set(s.start, [s]);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([start, options]) => ({ start, options }));
}

/**
 * Escolhe o profissional para um horário quando o cliente não tem preferência:
 * 1) o preferido do cliente, se disponível; 2) o com menos minutos ocupados no dia;
 * 3) a ordem de exibição definida pelo estabelecimento.
 */
export function rankProfessionals(
  candidates: readonly string[],
  dayLoadMin: Readonly<Record<string, number>>,
  preferredProfessionalId?: string | null,
): string[] {
  const idx = new Map(candidates.map((c, i) => [c, i]));
  return [...candidates].sort((a, b) => {
    if (preferredProfessionalId) {
      if (a === preferredProfessionalId) return -1;
      if (b === preferredProfessionalId) return 1;
    }
    return (dayLoadMin[a] ?? 0) - (dayLoadMin[b] ?? 0) || (idx.get(a) ?? 0) - (idx.get(b) ?? 0);
  });
}

/**
 * Seleciona poucos horários representativos para oferecer em conversa (voz/WhatsApp),
 * espalhados ao longo do período, sempre incluindo o primeiro disponível.
 */
export function pickRepresentativeStarts(starts: readonly number[], max = 4): number[] {
  const uniq = [...new Set(starts)].sort((a, b) => a - b);
  if (uniq.length <= max) return uniq;
  if (max <= 1) return uniq.slice(0, 1);
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const pos = Math.round((i * (uniq.length - 1)) / (max - 1));
    const v = uniq[pos]!;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Converte jornadas no formato de banco ('HH:mm:ss') para WeeklyInterval, validando. */
export function toWeeklyIntervals(
  rows: readonly { weekday: number; startTime: string; endTime: string }[],
): WeeklyInterval[] {
  return rows.map((r) => {
    if (r.weekday < 1 || r.weekday > 7) throw new RangeError(`Dia da semana inválido: ${r.weekday}`);
    const start = minutesToTime(timeToMinutes(r.startTime));
    const end = minutesToTime(timeToMinutes(r.endTime));
    if (timeToMinutes(end) <= timeToMinutes(start)) throw new RangeError('Faixa de horário inválida');
    return { weekday: r.weekday as IsoWeekday, start, end };
  });
}

/** Valida uma lista de faixas semanais: horas válidas, início < fim e sem sobreposição no mesmo dia. */
export function validateWeeklyIntervals(list: readonly WeeklyInterval[]): string | null {
  for (const w of list) {
    if (!Number.isInteger(w.weekday) || w.weekday < 1 || w.weekday > 7) return 'Dia da semana inválido.';
    let s: number;
    let e: number;
    try {
      s = timeToMinutes(w.start);
      e = timeToMinutes(w.end);
    } catch {
      return 'Horário inválido. Use o formato HH:mm.';
    }
    if (e <= s) return 'O horário final deve ser maior que o inicial.';
  }
  for (let d = 1; d <= 7; d++) {
    const day = list
      .filter((w) => w.weekday === d)
      .map((w) => [timeToMinutes(w.start), timeToMinutes(w.end)] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < day.length; i++) {
      if (day[i]![0] < day[i - 1]![1]) return 'Há faixas de horário sobrepostas no mesmo dia.';
    }
  }
  return null;
}
