import { DateTime, IANAZone } from 'luxon';

/**
 * Utilitários de data/hora no fuso do estabelecimento.
 *
 * Convenções do domínio:
 * - Instantes são armazenados em UTC (timestamptz) e manipulados como epoch ms.
 * - Datas locais: 'YYYY-MM-DD'. Horas locais: 'HH:mm'.
 * - Dia da semana: ISO 8601 (1 = segunda ... 7 = domingo), igual ao Luxon.
 */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Fusos horários do Brasil (IANA) oferecidos no cadastro. */
export const BRAZIL_TIMEZONES = [
  { id: 'America/Sao_Paulo', label: 'Brasília (SP, RJ, MG, Sul, GO, DF...)' },
  { id: 'America/Bahia', label: 'Bahia' },
  { id: 'America/Fortaleza', label: 'Fortaleza (CE, RN, PB, PI, MA)' },
  { id: 'America/Recife', label: 'Recife (PE)' },
  { id: 'America/Maceio', label: 'Maceió (AL, SE)' },
  { id: 'America/Belem', label: 'Belém (PA leste, AP)' },
  { id: 'America/Santarem', label: 'Santarém (PA oeste)' },
  { id: 'America/Araguaina', label: 'Araguaína (TO)' },
  { id: 'America/Cuiaba', label: 'Cuiabá (MT)' },
  { id: 'America/Campo_Grande', label: 'Campo Grande (MS)' },
  { id: 'America/Manaus', label: 'Manaus (AM leste)' },
  { id: 'America/Porto_Velho', label: 'Porto Velho (RO)' },
  { id: 'America/Boa_Vista', label: 'Boa Vista (RR)' },
  { id: 'America/Rio_Branco', label: 'Rio Branco (AC)' },
  { id: 'America/Noronha', label: 'Fernando de Noronha' },
] as const;

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAY_NAMES_PT: Record<IsoWeekday, string> = {
  1: 'segunda-feira',
  2: 'terça-feira',
  3: 'quarta-feira',
  4: 'quinta-feira',
  5: 'sexta-feira',
  6: 'sábado',
  7: 'domingo',
};

export const WEEKDAY_SHORT_PT: Record<IsoWeekday, string> = {
  1: 'seg',
  2: 'ter',
  3: 'qua',
  4: 'qui',
  5: 'sex',
  6: 'sáb',
  7: 'dom',
};

export const MONTH_NAMES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function isValidTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

export function isValidLocalDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  return DateTime.fromISO(date, { zone: 'UTC' }).isValid;
}

export function isValidLocalTime(time: string): boolean {
  return TIME_RE.test(time);
}

/** 'HH:mm' ou 'HH:mm:ss' → minutos desde a meia-noite. */
export function timeToMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new RangeError(`Hora inválida: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minutos desde a meia-noite → 'HH:mm' (aceita 0..1439). */
export function minutesToTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new RangeError(`Minutos fora do intervalo do dia: ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normaliza 'HH:mm:ss' do PostgreSQL para 'HH:mm'. */
export function normalizeTime(time: string): string {
  return minutesToTime(timeToMinutes(time));
}

interface DayOffsetInfo {
  /** O offset do fuso é o mesmo durante todo o dia (sem transição de horário de verão). */
  uniform: boolean;
  /** Date.UTC da data às 00:00. */
  utcMidnight: number;
  /** Offset em minutos (ex.: -180 para UTC-3). */
  offsetMin: number;
}

const dayOffsetCache = new Map<string, DayOffsetInfo>();

/**
 * Informações de offset por (fuso, data), memoizadas. Em dias sem transição de horário de
 * verão (a imensa maioria — e todos no Brasil desde 2019), a conversão local→UTC vira
 * aritmética simples, muito mais rápida que o Luxon. Dias com transição usam o Luxon.
 */
function dayOffsetInfo(date: string, zone: string): DayOffsetInfo {
  const key = `${zone}|${date}`;
  const cached = dayOffsetCache.get(key);
  if (cached) return cached;
  const start = DateTime.fromISO(`${date}T00:00`, { zone });
  if (!start.isValid) throw new RangeError(`Data inválida: ${date} (${zone})`);
  const end = DateTime.fromISO(`${date}T23:59`, { zone });
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const info: DayOffsetInfo = {
    uniform: start.offset === end.offset && start.hour === 0,
    utcMidnight: Date.UTC(y, m - 1, d),
    offsetMin: start.offset,
  };
  if (dayOffsetCache.size > 20_000) dayOffsetCache.clear();
  dayOffsetCache.set(key, info);
  return info;
}

/**
 * Converte data + hora locais de um fuso para instante UTC (epoch ms).
 * Em lacunas de horário de verão (hora inexistente), o Luxon avança para a próxima hora válida.
 */
export function localToInstant(date: string, time: string, zone: string): number {
  const minutes = timeToMinutes(time);
  const info = dayOffsetInfo(date, zone);
  if (info.uniform) return info.utcMidnight + (minutes - info.offsetMin) * 60_000;
  const dt = DateTime.fromISO(`${date}T${minutesToTime(minutes)}`, { zone });
  if (!dt.isValid) throw new RangeError(`Data/hora inválida: ${date} ${time} (${zone})`);
  return dt.toMillis();
}

/** Instante do início (00:00) da data local. */
export function startOfLocalDay(date: string, zone: string): number {
  const dt = DateTime.fromISO(date, { zone }).startOf('day');
  if (!dt.isValid) throw new RangeError(`Data inválida: ${date}`);
  return dt.toMillis();
}

export interface LocalParts {
  date: string;
  time: string;
  weekday: IsoWeekday;
  minutesOfDay: number;
}

const isoDateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function instantToLocal(instant: number, zone: string): LocalParts {
  // caminho rápido: dia sem transição de horário de verão
  const utcDate = isoDateOf(instant);
  const first = dayOffsetInfo(utcDate, zone);
  const localDate = isoDateOf(instant + first.offsetMin * 60_000);
  const info = localDate === utcDate ? first : dayOffsetInfo(localDate, zone);
  if (info.uniform) {
    const local = new Date(instant + info.offsetMin * 60_000);
    if (isoDateOf(local.getTime()) === localDate) {
      const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
      return {
        date: localDate,
        time: minutesToTime(minutesOfDay),
        weekday: (((local.getUTCDay() + 6) % 7) + 1) as IsoWeekday,
        minutesOfDay,
      };
    }
  }
  const dt = DateTime.fromMillis(instant, { zone });
  return {
    date: dt.toISODate()!,
    time: dt.toFormat('HH:mm'),
    weekday: dt.weekday as IsoWeekday,
    minutesOfDay: dt.hour * 60 + dt.minute,
  };
}

export function todayInZone(zone: string, now: number = Date.now()): string {
  return instantToLocal(now, zone).date;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate()!;
}

export function weekdayOf(date: string): IsoWeekday {
  return DateTime.fromISO(date, { zone: 'UTC' }).weekday as IsoWeekday;
}

export function diffDays(from: string, to: string): number {
  return Math.round(
    DateTime.fromISO(to, { zone: 'UTC' }).diff(DateTime.fromISO(from, { zone: 'UTC' }), 'days').days,
  );
}

/** Lista as datas locais de `from` até `to` (inclusive). */
export function eachDate(from: string, to: string, maxDays = 400): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    if (out.length > maxDays) throw new RangeError('Intervalo de datas grande demais');
    cur = addDays(cur, 1);
  }
  return out;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ex.: "sexta-feira, 6 de novembro". */
export function formatLongDatePt(date: string): string {
  const dt = DateTime.fromISO(date, { zone: 'UTC' });
  const wd = WEEKDAY_NAMES_PT[dt.weekday as IsoWeekday];
  return `${wd}, ${dt.day} de ${MONTH_NAMES_PT[dt.month - 1]}`;
}
