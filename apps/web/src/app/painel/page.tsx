'use client';

import { APPOINTMENT_STATUS_LABELS } from '@barber-voice/contracts';
import { ArrowRight, CalendarDays, PhoneOff, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice, Skeleton } from '@/components/ui/card';
import { formatBRL, longDate, percent, timeIn } from '@/lib/format';
import { useDashboard } from '@/lib/hooks';
import { useSession, useTenant } from '@/lib/session';

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'brass';
}) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-[12px] leading-snug text-ink-500 sm:text-[13px]">{label}</p>
      <p
        className={
          tone === 'brass'
            ? 'mt-2 font-display text-[26px] leading-none text-brass-700 sm:text-[34px]'
            : 'mt-2 font-display text-[28px] leading-none text-ink-900 sm:text-[34px]'
        }
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-[11px] leading-snug text-ink-400 sm:text-xs">{hint}</p> : null}
    </Card>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Barras por hora com faixa contínua (horas sem agendamento aparecem zeradas). */
function HoursChart({ data }: { data: { hour: number; count: number }[] }) {
  const BAR_AREA = 112;
  const min = Math.min(...data.map((d) => d.hour));
  const max = Math.max(...data.map((d) => d.hour));
  const from = Math.min(min, 8);
  const to = Math.max(max, 19);
  const counts = new Map(data.map((d) => [d.hour, d.count]));
  const peak = Math.max(1, ...data.map((d) => d.count));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div
      className="flex items-end gap-1 sm:gap-1.5"
      role="img"
      aria-label="Distribuição de agendamentos por hora do dia"
    >
      {hours.map((h) => {
        const c = counts.get(h) ?? 0;
        return (
          <div key={h} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div
              className={
                c
                  ? 'w-full rounded-t-md bg-ink-800 transition-colors hover:bg-brass-500'
                  : 'w-full rounded-t-md bg-ink-100'
              }
              style={{ height: c ? Math.max(6, (c / peak) * BAR_AREA) : 3 }}
              title={`${h}h: ${plural(c, 'agendamento', 'agendamentos')}`}
            />
            {/* altura fixa: rótulos vazios (horas ímpares) não podem desalinhar a linha de base */}
            <span className="h-3 text-[10px] leading-3 tabular text-ink-400">
              {h % 2 === 0 ? `${h}h` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const statusTone = {
  CONFIRMED: 'info',
  PENDING: 'warning',
  COMPLETED: 'success',
  NO_SHOW: 'danger',
  HELD: 'brass',
} as const;

export default function DashboardPage() {
  const { me } = useSession();
  const { tz } = useTenant();
  const { data, isPending, error, refetch } = useDashboard();
  const firstName = me.user.name.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={data ? longDate(data.date).replace(/^./, (c) => c.toUpperCase()) : ' '}
        actions={
          <Button asChild>
            <Link href="/painel/agenda?novo=1">
              <Plus className="size-4" /> Novo agendamento
            </Link>
          </Button>
        }
      />

      {error ? (
        <Notice tone="danger" title="Não foi possível carregar os indicadores">
          {error.message}{' '}
          <button className="font-medium underline" onClick={() => refetch()}>
            Tentar novamente
          </button>
        </Notice>
      ) : null}

      {isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Stat
              label="Agendamentos hoje"
              value={data.appointments.today}
              hint={`${data.appointments.upcomingToday} ainda por vir`}
            />
            <Stat
              label="Nesta semana"
              value={data.appointments.week}
              hint={`${data.appointments.month} no mês`}
            />
            <Stat
              label="Faturamento registrado no mês"
              value={formatBRL(data.revenue.registeredThisMonthCents)}
              tone="brass"
              hint={
                data.revenue.estimatedItemsThisMonth
                  ? `Atendimentos concluídos · ${data.revenue.estimatedItemsThisMonth} com preço "a partir de"`
                  : 'Soma dos atendimentos concluídos'
              }
            />
            <Stat
              label="Ocupação da semana"
              value={percent(data.occupancy.weekRate)}
              hint="Agendado ÷ jornada disponível"
            />
            <Stat
              label="Clientes novos no mês"
              value={data.customers.newThisMonth}
              hint={`${plural(data.customers.total, 'cliente', 'clientes')} no total`}
            />
            <Stat
              label="Clientes recorrentes no mês"
              value={data.customers.returningThisMonth}
              hint="Voltaram após visita anterior"
            />
            <Stat
              label="Cancelamentos no mês"
              value={data.quality.cancellationsThisMonth}
              hint="Remarcações não contam"
            />
            <Stat label="Faltas no mês" value={data.quality.noShowsThisMonth} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                title="Agenda de hoje"
                description={plural(data.todayAgenda.length, 'atendimento', 'atendimentos')}
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/painel/agenda">
                      Ver agenda <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                }
              />
              <CardBody className="px-0 sm:px-0">
                {data.todayAgenda.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="size-5" />}
                    title="Nenhum atendimento hoje"
                    description="Os agendamentos feitos pelo painel e pela recepcionista aparecem aqui."
                  />
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {data.todayAgenda.map((a) => (
                      <li key={a.id} className="flex items-center gap-4 px-5 py-3 sm:px-6">
                        <span className="w-14 shrink-0 font-mono text-sm tabular text-ink-900">
                          {timeIn(a.startsAt, tz)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-900">
                            {a.customerName}
                          </span>
                          <span className="block truncate text-[13px] text-ink-500">
                            {a.services.join(' + ')} · {a.professionalName}
                          </span>
                        </span>
                        <Badge tone={statusTone[a.status as keyof typeof statusTone] ?? 'neutral'}>
                          {APPOINTMENT_STATUS_LABELS[a.status as keyof typeof APPOINTMENT_STATUS_LABELS] ??
                            a.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader title="Serviços mais agendados" description="Mês atual" />
                <CardBody>
                  {data.topServices.length === 0 ? (
                    <p className="text-sm text-ink-400">Sem dados suficientes ainda.</p>
                  ) : (
                    <ul className="space-y-3">
                      {data.topServices.map((s) => {
                        const max = data.topServices[0]!.count;
                        return (
                          <li key={s.serviceId}>
                            <div className="flex justify-between text-sm">
                              <span className="text-ink-800">{s.name}</span>
                              <span className="tabular text-ink-500">{s.count}</span>
                            </div>
                            <div className="mt-1.5 h-1.5 rounded-full bg-ink-100">
                              <div
                                className="h-full rounded-full bg-brass-500"
                                style={{ width: `${(s.count / max) * 100}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Canais de atendimento" />
                <CardBody>
                  <div className="flex items-start gap-3 rounded-xl bg-ink-50 p-4">
                    <PhoneOff className="mt-0.5 size-5 shrink-0 text-ink-400" />
                    <div>
                      <p className="text-sm font-medium text-ink-800">
                        Telefone e WhatsApp ainda não integrados
                      </p>
                      <p className="mt-1 text-[13px] text-ink-500">
                        Ligações recebidas, atendidas e perdidas aparecem aqui após a ativação dos canais
                        (Fase 4). Nenhum número é estimado.
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Profissionais com mais atendimentos" description="Mês atual" />
              <CardBody>
                {data.topProfessionals.length === 0 ? (
                  <p className="text-sm text-ink-400">Sem dados suficientes ainda.</p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {data.topProfessionals.map((p, i) => (
                      <li key={p.professionalId} className="flex items-center justify-between py-2.5 text-sm">
                        <span className="flex items-center gap-3">
                          <span className="font-display text-lg text-ink-300">{i + 1}</span>
                          <span className="text-ink-800">{p.name}</span>
                        </span>
                        <span className="tabular text-ink-500">{p.count} atend.</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Horários mais procurados" description="Últimos e próximos 30 dias" />
              <CardBody>
                {data.busiestHours.length === 0 ? (
                  <p className="text-sm text-ink-400">Sem dados suficientes ainda.</p>
                ) : (
                  <HoursChart data={data.busiestHours} />
                )}
              </CardBody>
            </Card>
          </div>

          <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-ink-900 text-brass-300">
                <Users className="size-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink-900">Clientes e histórico</p>
                <p className="text-[13px] text-ink-500">Consulte visitas, preferências e consentimentos.</p>
              </div>
            </div>
            <Button asChild variant="secondary">
              <Link href="/painel/clientes">Abrir CRM</Link>
            </Button>
          </Card>
        </div>
      ) : null}
    </>
  );
}
