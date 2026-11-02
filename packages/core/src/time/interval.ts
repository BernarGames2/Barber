/**
 * Aritmética de intervalos semiabertos [start, end) em milissegundos desde a época Unix.
 * Todas as funções são puras e retornam listas normalizadas (ordenadas, sem sobreposição,
 * sem intervalos vazios). Intervalos adjacentes ([a,b) e [b,c)) são unidos.
 */
export interface Interval {
  start: number;
  end: number;
}

export function isEmpty(i: Interval): boolean {
  return !(i.end > i.start);
}

export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => !isEmpty(i))
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

/** Interseção entre dois conjuntos de intervalos. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const x = normalize(a);
  const y = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const p = x[i]!;
    const q = y[j]!;
    const start = Math.max(p.start, q.start);
    const end = Math.min(p.end, q.end);
    if (end > start) out.push({ start, end });
    if (p.end < q.end) i++;
    else j++;
  }
  return out;
}

/** Remove de `base` todos os trechos cobertos por `remove`. */
export function subtract(base: readonly Interval[], remove: readonly Interval[]): Interval[] {
  const src = normalize(base);
  const cut = normalize(remove);
  const out: Interval[] = [];
  let j = 0;

  for (const seg of src) {
    let cursor = seg.start;
    // avança cortes que terminam antes deste segmento
    while (j < cut.length && cut[j]!.end <= seg.start) j++;
    let k = j;
    while (k < cut.length && cut[k]!.start < seg.end) {
      const c = cut[k]!;
      if (c.start > cursor) out.push({ start: cursor, end: Math.min(c.start, seg.end) });
      cursor = Math.max(cursor, c.end);
      if (cursor >= seg.end) break;
      k++;
    }
    if (cursor < seg.end) out.push({ start: cursor, end: seg.end });
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Verdadeiro se `target` está inteiramente contido em algum intervalo de `container`. */
export function containsInterval(container: readonly Interval[], target: Interval): boolean {
  if (isEmpty(target)) return false;
  return normalize(container).some((c) => c.start <= target.start && target.end <= c.end);
}

export function totalDuration(intervals: readonly Interval[]): number {
  return normalize(intervals).reduce((acc, i) => acc + (i.end - i.start), 0);
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
