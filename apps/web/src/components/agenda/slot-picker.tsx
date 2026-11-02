'use client';

import type { AvailabilitySlotDto } from '@barber-voice/contracts';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { timeIn } from '@/lib/format';

const PERIODS = [
  { label: 'Manhã', from: 0, to: 12 * 60 },
  { label: 'Tarde', from: 12 * 60, to: 18 * 60 },
  { label: 'Noite', from: 18 * 60, to: 24 * 60 },
];

/** Horários livres vindos da API (agenda real), agrupados por período do dia. */
export function SlotPicker({
  slots,
  loading,
  error,
  tz,
  value,
  onChange,
  professionalNames,
}: {
  slots: AvailabilitySlotDto[] | undefined;
  loading: boolean;
  error?: string | null;
  tz: string;
  value: string | null;
  onChange: (slot: AvailabilitySlotDto) => void;
  professionalNames?: Record<string, string>;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-ink-500">
        <Spinner className="size-4" /> Consultando a agenda…
      </div>
    );
  }
  if (error) return <p className="py-3 text-sm text-rose-700">{error}</p>;
  if (!slots || slots.length === 0) {
    return (
      <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-500">
        Nenhum horário livre nesta data para os serviços escolhidos.
      </p>
    );
  }
  const minutes = (iso: string) => {
    const [h, m] = timeIn(iso, tz).split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  return (
    <div className="flex flex-col gap-4">
      {PERIODS.map((p) => {
        const list = slots.filter((s) => minutes(s.start) >= p.from && minutes(s.start) < p.to);
        if (!list.length) return null;
        return (
          <div key={p.label}>
            <p className="mb-2 text-xs font-medium tracking-wide text-ink-400 uppercase">{p.label}</p>
            <div className="flex flex-wrap gap-2">
              {list.map((s) => {
                const selected = value === s.start;
                const who =
                  professionalNames && s.professionalIds.length === 1
                    ? professionalNames[s.professionalIds[0]!]
                    : null;
                return (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => onChange(s)}
                    aria-pressed={selected}
                    title={who ? `Com ${who}` : `${s.professionalIds.length} profissional(is) livre(s)`}
                    className={cn(
                      'h-9 min-w-[68px] rounded-lg px-3 font-mono text-sm tabular ring-1 transition-colors',
                      selected
                        ? 'bg-ink-900 text-paper ring-ink-900'
                        : 'bg-white text-ink-800 ring-ink-200 hover:bg-brass-50 hover:ring-brass-300',
                    )}
                  >
                    {timeIn(s.start, tz)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
