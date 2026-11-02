'use client';

import type { AppointmentDto, ProfessionalDto, TimeOffDto, WeeklyIntervalDto } from '@barber-voice/contracts';
import { TIME_OFF_KIND_LABELS } from '@barber-voice/contracts';
import { timeToMinutes } from '@barber-voice/core';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { AppointmentDetailsDialog, STATUS_TONE } from '@/components/agenda/appointment-details-dialog';
import { CreateAppointmentDialog, type CreatePrefill } from '@/components/agenda/create-appointment-dialog';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { addDaysIso, longDate, relativeDay, timeIn, todayIn } from '@/lib/format';
import { useAppointments, useBusinessHours, useProfessionals, useTimeOff } from '@/lib/hooks';
import { useTenant } from '@/lib/session';

const PX_PER_MIN = 1.1;

function minutesIn(iso: string, tz: string) {
  const d = DateTime.fromISO(iso, { zone: tz });
  return d.hour * 60 + d.minute;
}

function workingIntervalsFor(p: ProfessionalDto, weekday: number, business: WeeklyIntervalDto[]) {
  const src = p.usesBusinessHours || !p.workingHours ? business : p.workingHours;
  const own = src
    .filter((w) => w.weekday === weekday)
    .map((w) => [timeToMinutes(w.start), timeToMinutes(w.end)] as const);
  // limita à abertura do estabelecimento (mesma regra do motor de disponibilidade)
  const biz = business
    .filter((w) => w.weekday === weekday)
    .map((w) => [timeToMinutes(w.start), timeToMinutes(w.end)] as const);
  const out: [number, number][] = [];
  for (const [s, e] of own)
    for (const [bs, be] of biz)
      if (Math.min(e, be) > Math.max(s, bs)) out.push([Math.max(s, bs), Math.min(e, be)]);
  return out;
}

const blockTone: Record<string, string> = {
  CONFIRMED: 'bg-white ring-ink-200 before:bg-brass-500',
  PENDING: 'bg-amber-50 ring-amber-300 before:bg-amber-500',
  HELD: 'bg-brass-50 ring-brass-300 ring-dashed before:bg-brass-400',
  COMPLETED: 'bg-emerald-50 ring-emerald-200 before:bg-emerald-600',
  NO_SHOW: 'bg-rose-50 ring-rose-200 before:bg-rose-500',
};

function DayGrid({
  date,
  tz,
  professionals,
  appointments,
  timeOff,
  business,
  slotMin,
  onSelect,
  onEmpty,
}: {
  date: string;
  tz: string;
  professionals: ProfessionalDto[];
  appointments: AppointmentDto[];
  timeOff: TimeOffDto[];
  business: WeeklyIntervalDto[];
  slotMin: number;
  onSelect: (a: AppointmentDto) => void;
  onEmpty: (professionalId: string, time: string) => void;
}) {
  const weekday = DateTime.fromISO(date).weekday;
  const bizToday = business.filter((b) => b.weekday === weekday);
  let start = bizToday.length ? Math.min(...bizToday.map((b) => timeToMinutes(b.start))) : 8 * 60;
  let end = bizToday.length ? Math.max(...bizToday.map((b) => timeToMinutes(b.end))) : 20 * 60;
  for (const a of appointments) {
    start = Math.min(start, minutesIn(a.startsAt, tz));
    end = Math.max(end, minutesIn(a.endsAt, tz) || 24 * 60);
  }
  start = Math.floor(start / 60) * 60;
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
  const height = (end - start) * PX_PER_MIN;
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);

  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMin(todayIn(tz) === date ? minutesIn(DateTime.now().toISO()!, tz) : null);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [date, tz]);

  return (
    <Card className="overflow-hidden">
      <div className="scrollbar-thin overflow-x-auto">
        <div className="min-w-fit">
          <div className="sticky top-0 z-10 flex border-b border-ink-100 bg-white">
            <div className="w-16 shrink-0" />
            {professionals.map((p) => (
              <div
                key={p.id}
                className="flex min-w-[200px] flex-1 items-center gap-2 border-l border-ink-100 px-3 py-3"
              >
                <span className="size-2.5 rounded-full" style={{ background: p.color ?? '#b8892f' }} />
                <span className="truncate text-sm font-medium text-ink-900">{p.name}</span>
                <span className="ml-auto text-xs text-ink-400">
                  {appointments.filter((a) => a.professional.id === p.id).length}
                </span>
              </div>
            ))}
          </div>
          <div className="relative flex" style={{ height }}>
            <div className="relative w-16 shrink-0">
              {hours.map((h, i) => (
                <span
                  key={h}
                  // o primeiro rótulo desce um pouco para não ser cortado pelo cabeçalho fixo
                  className={cn(
                    'absolute right-3 font-mono text-[11px] tabular text-ink-400',
                    i === 0 ? 'translate-y-0.5' : '-translate-y-1/2',
                  )}
                  style={{ top: (h - start) * PX_PER_MIN }}
                >
                  {String(h / 60).padStart(2, '0')}:00
                </span>
              ))}
            </div>
            {professionals.map((p) => {
              const work = workingIntervalsFor(p, weekday, business);
              const mine = appointments.filter((a) => a.professional.id === p.id);
              const off = timeOff.filter((t) => t.professionalId === p.id);
              return (
                <div
                  key={p.id}
                  className="relative min-w-[200px] flex-1 cursor-pointer border-l border-ink-100 bg-ink-50/80"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const minute = start + (e.clientY - rect.top) / PX_PER_MIN;
                    const snapped = Math.floor(minute / slotMin) * slotMin;
                    const t = `${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`;
                    onEmpty(p.id, t);
                  }}
                  role="presentation"
                >
                  {work.map(([s, e2]) => (
                    <div
                      key={s}
                      className="absolute inset-x-0 bg-white"
                      style={{ top: (s - start) * PX_PER_MIN, height: (e2 - s) * PX_PER_MIN }}
                    />
                  ))}
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="pointer-events-none absolute inset-x-0 border-t border-ink-100"
                      style={{ top: (h - start) * PX_PER_MIN }}
                    />
                  ))}
                  {off.map((t) => {
                    const s = Math.max(
                      start,
                      DateTime.fromISO(t.startsAt, { zone: tz }).toISODate() === date
                        ? minutesIn(t.startsAt, tz)
                        : start,
                    );
                    const e2 = Math.min(
                      end,
                      DateTime.fromISO(t.endsAt, { zone: tz }).toISODate() === date
                        ? minutesIn(t.endsAt, tz)
                        : end,
                    );
                    if (e2 <= s) return null;
                    return (
                      <div
                        key={t.id}
                        className="hatch absolute inset-x-1 rounded-lg ring-1 ring-ink-150"
                        style={{ top: (s - start) * PX_PER_MIN, height: (e2 - s) * PX_PER_MIN }}
                      >
                        <span className="m-2 inline-block rounded bg-white/80 px-1.5 py-0.5 text-[11px] text-ink-500">
                          {TIME_OFF_KIND_LABELS[t.kind]}
                          {t.reason ? ` · ${t.reason}` : ''}
                        </span>
                      </div>
                    );
                  })}
                  {mine.map((a) => {
                    const s = minutesIn(a.startsAt, tz);
                    const dur = Math.max(
                      18,
                      (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000,
                    );
                    return (
                      <button
                        key={a.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelect(a);
                        }}
                        className={cn(
                          'absolute right-1.5 left-1.5 overflow-hidden rounded-lg px-2.5 py-1.5 text-left shadow-sm ring-1 transition-shadow hover:shadow-pop',
                          'before:absolute before:top-0 before:bottom-0 before:left-0 before:w-[3px]',
                          blockTone[a.status] ?? blockTone.CONFIRMED,
                          a.isOverbook && 'right-1.5 left-8 z-[1]',
                        )}
                        style={{ top: (s - start) * PX_PER_MIN + 1, height: dur * PX_PER_MIN - 2 }}
                      >
                        <p className="truncate text-[12px] font-semibold text-ink-900">
                          <span className="font-mono tabular">{timeIn(a.startsAt, tz)}</span>{' '}
                          {a.customer.name}
                        </p>
                        {dur >= 35 ? (
                          <p className="truncate text-[11px] text-ink-500">
                            {a.items.map((i) => i.serviceName).join(' + ')}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                  {nowMin !== null && nowMin >= start && nowMin <= end ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-[2] border-t-2 border-rose-500"
                      style={{ top: (nowMin - start) * PX_PER_MIN }}
                    >
                      <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-rose-500" />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function MobileList({
  appointments,
  tz,
  onSelect,
}: {
  appointments: AppointmentDto[];
  tz: string;
  onSelect: (a: AppointmentDto) => void;
}) {
  if (!appointments.length) {
    return <EmptyState icon={<CalendarDays className="size-5" />} title="Nenhum agendamento neste dia" />;
  }
  return (
    <Card className="divide-y divide-ink-100">
      {appointments.map((a) => (
        <button
          key={a.id}
          onClick={() => onSelect(a)}
          className="flex w-full items-center gap-4 px-4 py-3.5 text-left active:bg-ink-50"
        >
          <span className="w-12 shrink-0">
            <span className="block font-mono text-sm tabular text-ink-900">{timeIn(a.startsAt, tz)}</span>
            <span className="block font-mono text-[11px] tabular text-ink-400">{timeIn(a.endsAt, tz)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink-900">{a.customer.name}</span>
            <span className="block truncate text-[13px] text-ink-500">
              {a.items.map((i) => i.serviceName).join(' + ')} · {a.professional.name}
            </span>
          </span>
          <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>
            {a.isOverbook
              ? 'Encaixe'
              : a.status === 'CONFIRMED'
                ? 'Confirmado'
                : a.status === 'COMPLETED'
                  ? 'Concluído'
                  : a.status === 'NO_SHOW'
                    ? 'Falta'
                    : 'Pendente'}
          </Badge>
        </button>
      ))}
    </Card>
  );
}

function AgendaView() {
  const { tz, tenant } = useTenant();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayIn(tz);
  const date = params.get('data') ?? today;
  const [professionalFilter, setProfessionalFilter] = useState('');
  const [selected, setSelected] = useState<AppointmentDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [prefill, setPrefill] = useState<CreatePrefill>({ date });

  useEffect(() => {
    if (params.get('novo') === '1') {
      setPrefill({ date });
      setCreateOpen(true);
      router.replace('/painel/agenda');
    }
  }, [params, date, router]);

  const setDate = (d: string) => router.replace(d === today ? '/painel/agenda' : `/painel/agenda?data=${d}`);

  const professionals = useProfessionals();
  const business = useBusinessHours();
  const appts = useAppointments(date, date, professionalFilter || undefined);
  const dayStart = useMemo(() => DateTime.fromISO(date, { zone: tz }).startOf('day').toISO()!, [date, tz]);
  const dayEnd = useMemo(
    () => DateTime.fromISO(date, { zone: tz }).plus({ days: 1 }).startOf('day').toISO()!,
    [date, tz],
  );
  const timeOff = useTimeOff(dayStart, dayEnd);

  const visibleProfessionals = (professionals.data ?? []).filter(
    (p) => p.active && (!professionalFilter || p.id === professionalFilter),
  );
  const loading = professionals.isPending || business.isPending || appts.isPending;

  return (
    <>
      <PageHeader
        title="Agenda"
        description={longDate(date).replace(/^./, (c) => c.toUpperCase())}
        actions={
          <Button
            onClick={() => {
              setPrefill({ date });
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" /> Novo agendamento
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setDate(addDaysIso(date, -1))}
            aria-label="Dia anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant={date === today ? 'primary' : 'secondary'} size="md" onClick={() => setDate(today)}>
            Hoje
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setDate(addDaysIso(date, 1))}
            aria-label="Próximo dia"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="ml-1 h-10 w-40"
            aria-label="Escolher data"
          />
          <span className="ml-2 hidden text-sm text-ink-500 md:inline">{relativeDay(date, today)}</span>
        </div>
        <div className="w-full sm:w-56">
          <Select
            value={professionalFilter}
            onChange={(e) => setProfessionalFilter(e.target.value)}
            aria-label="Filtrar por profissional"
          >
            <option value="">Todos os profissionais</option>
            {(professionals.data ?? [])
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-[520px] rounded-2xl" />
      ) : visibleProfessionals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title="Cadastre profissionais para usar a agenda"
            description="A agenda é organizada por profissional, com a jornada de cada um."
          />
        </Card>
      ) : (
        <>
          <div className="hidden md:block">
            <DayGrid
              date={date}
              tz={tz}
              professionals={visibleProfessionals}
              appointments={appts.data ?? []}
              timeOff={timeOff.data ?? []}
              business={business.data ?? []}
              slotMin={tenant?.slotIntervalMin ?? 30}
              onSelect={setSelected}
              onEmpty={(professionalId, time) => {
                setPrefill({ date, time, professionalId });
                setCreateOpen(true);
              }}
            />
            <p className="mt-3 text-xs text-ink-400">
              Clique em um espaço livre para agendar naquele horário. Áreas cinza estão fora da jornada.
            </p>
          </div>
          <div className="md:hidden">
            <MobileList appointments={appts.data ?? []} tz={tz} onSelect={setSelected} />
          </div>
        </>
      )}

      <CreateAppointmentDialog open={createOpen} onOpenChange={setCreateOpen} prefill={prefill} />
      <AppointmentDetailsDialog appointment={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  );
}

export default function AgendaPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[520px] rounded-2xl" />}>
      <AgendaView />
    </Suspense>
  );
}
