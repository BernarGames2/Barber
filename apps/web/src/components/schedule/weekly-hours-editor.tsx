'use client';

import type { WeeklyIntervalDto } from '@barber-voice/contracts';
import { WEEKDAY_LABELS } from '@barber-voice/contracts';
import { type WeeklyInterval, validateWeeklyIntervals } from '@barber-voice/core';
import { Copy, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const SUGGESTED_HOURS: WeeklyIntervalDto[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '19:00' })),
  { weekday: 6, start: '09:00', end: '15:00' },
];

export function weeklyError(value: WeeklyIntervalDto[]): string | null {
  return validateWeeklyIntervals(value as WeeklyInterval[]);
}

function TimeBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <input
      type="time"
      step={300}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-[104px] rounded-lg border border-ink-200 bg-white px-2.5 text-sm tabular text-ink-900 hover:border-ink-300 focus:border-brass-500 focus:shadow-glow focus:outline-none"
    />
  );
}

/**
 * Editor de jornada semanal com várias faixas por dia (ex.: 09:00–12:00 e 13:00–19:00
 * para representar o intervalo de almoço).
 */
export function WeeklyHoursEditor({
  value,
  onChange,
  className,
}: {
  value: WeeklyIntervalDto[];
  onChange: (v: WeeklyIntervalDto[]) => void;
  className?: string;
}) {
  const byDay = (d: number) => value.filter((v) => v.weekday === d);
  const setDay = (d: number, intervals: { start: string; end: string }[]) =>
    onChange(
      [...value.filter((v) => v.weekday !== d), ...intervals.map((i) => ({ weekday: d, ...i }))].sort(
        (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start),
      ),
    );

  const copyToWeekdays = (from: number) => {
    const src = byDay(from);
    const next = value.filter((v) => v.weekday > 5 || v.weekday === from);
    for (const d of [1, 2, 3, 4, 5]) if (d !== from) next.push(...src.map((s) => ({ ...s, weekday: d })));
    onChange(next.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)));
  };

  return (
    <div className={cn('divide-y divide-ink-100 rounded-2xl ring-1 ring-ink-150', className)}>
      {DAYS.map((d) => {
        const intervals = byDay(d);
        const open = intervals.length > 0;
        return (
          <div key={d} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
            <label className="flex w-36 shrink-0 cursor-pointer items-center gap-3 pt-2">
              <input
                type="checkbox"
                checked={open}
                onChange={(e) => setDay(d, e.target.checked ? [{ start: '09:00', end: '18:00' }] : [])}
                className="size-4 accent-ink-900"
              />
              <span className={cn('text-sm font-medium', open ? 'text-ink-900' : 'text-ink-400')}>
                {WEEKDAY_LABELS[d]}
              </span>
            </label>
            <div className="flex flex-1 flex-col gap-2">
              {!open ? <p className="pt-2 text-sm text-ink-400">Fechado</p> : null}
              {intervals.map((iv, idx) => (
                <div key={`${d}-${idx}`} className="flex items-center gap-2">
                  <TimeBox
                    label={`${WEEKDAY_LABELS[d]} início ${idx + 1}`}
                    value={iv.start}
                    onChange={(v) =>
                      setDay(
                        d,
                        intervals.map((x, j) => (j === idx ? { start: v, end: x.end } : x)),
                      )
                    }
                  />
                  <span className="text-sm text-ink-400">até</span>
                  <TimeBox
                    label={`${WEEKDAY_LABELS[d]} fim ${idx + 1}`}
                    value={iv.end}
                    onChange={(v) =>
                      setDay(
                        d,
                        intervals.map((x, j) => (j === idx ? { start: x.start, end: v } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDay(
                        d,
                        intervals.filter((_, j) => j !== idx),
                      )
                    }
                    className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                    aria-label="Remover faixa"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              {open ? (
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const last = intervals.at(-1);
                      setDay(d, [...intervals, { start: last?.end ?? '13:00', end: '19:00' }]);
                    }}
                  >
                    <Plus className="size-3.5" /> Adicionar faixa (ex.: após o almoço)
                  </Button>
                  {d <= 5 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => copyToWeekdays(d)}>
                      <Copy className="size-3.5" /> Copiar para seg–sex
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
