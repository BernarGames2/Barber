import { describePrice, formatBRL, formatPhoneDisplay, type PriceType } from '@barber-voice/core';
import { DateTime } from 'luxon';

export { formatBRL, formatPhoneDisplay };

export const priceLabel = (cents: number | null, type: PriceType) => describePrice(cents, type);

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Hora local 'HH:mm' de um instante ISO no fuso do estabelecimento. */
export function timeIn(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone }).toFormat('HH:mm');
}

export function dateIn(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone }).toISODate()!;
}

export function longDate(date: string): string {
  return DateTime.fromISO(date, { locale: 'pt-BR' }).toFormat("cccc, d 'de' LLLL");
}

export function shortDate(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone, locale: 'pt-BR' }).toFormat("dd/LL/yyyy 'às' HH:mm");
}

export function relativeDay(date: string, today: string): string {
  const d = DateTime.fromISO(date);
  const diff = Math.round(d.diff(DateTime.fromISO(today), 'days').days);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return d.setLocale('pt-BR').toFormat('ccc, dd/LL');
}

export function todayIn(zone: string): string {
  return DateTime.now().setZone(zone).toISODate()!;
}

export function addDaysIso(date: string, n: number): string {
  return DateTime.fromISO(date).plus({ days: n }).toISODate()!;
}

/** Data + hora locais → ISO com o offset correto do fuso (ex.: 2026-11-06T15:00:00.000-03:00). */
export function localToIso(date: string, time: string, zone: string): string {
  return DateTime.fromISO(`${date}T${time}`, { zone }).toISO()!;
}

export function percent(v: number | null): string {
  if (v === null) return '—';
  return `${Math.round(v * 100)}%`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/** Converte "45,90" (digitado) ↔ centavos. */
export function centsFromInput(value: string): number | null {
  const clean = value
    .replace(/[^\d,.]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}
