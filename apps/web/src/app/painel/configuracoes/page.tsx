'use client';

import type { ClosureDto, TenantDto, WeeklyIntervalDto } from '@barber-voice/contracts';
import { CLOSURE_KIND_LABELS } from '@barber-voice/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { WeeklyHoursEditor, weeklyError } from '@/components/schedule/weekly-hours-editor';
import { PageHeader } from '@/components/shell/app-shell';
import { BusinessForm, tenantToForm } from '@/components/tenant/business-form';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Notice, Skeleton } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { shortDate, todayIn } from '@/lib/format';
import { useBusinessHours, useClosures } from '@/lib/hooks';
import { useSession, useTenant } from '@/lib/session';

type Tab = 'estabelecimento' | 'horarios' | 'agenda' | 'conta';

function useInvalidateTenant() {
  const qc = useQueryClient();
  const { tenantId } = useTenant();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['tenant', tenantId] }),
      qc.invalidateQueries({ queryKey: ['me'] }),
      qc.invalidateQueries({ queryKey: ['availability', tenantId] }),
    ]);
}

function BusinessTab({ tenant }: { tenant: TenantDto }) {
  const { base, canManage } = useTenant();
  const invalidate = useInvalidateTenant();
  if (!canManage)
    return (
      <Notice tone="info">Somente proprietário e gerente podem alterar os dados do estabelecimento.</Notice>
    );
  return (
    <Card className="p-5 sm:p-7">
      <BusinessForm
        initial={tenantToForm(tenant)}
        submitLabel="Salvar alterações"
        onSubmit={async (v) => {
          await api(`${base}`, { method: 'PATCH', body: v });
          await invalidate();
          toast.success('Dados atualizados');
        }}
      />
    </Card>
  );
}

function HoursTab() {
  const { base, tenantId, tz, canManage } = useTenant();
  const qc = useQueryClient();
  const hours = useBusinessHours();
  const closures = useClosures();
  const [value, setValue] = useState<WeeklyIntervalDto[] | null>(null);
  const [closure, setClosure] = useState({ kind: 'HOLIDAY', title: '', from: todayIn(tz), to: todayIn(tz) });
  useEffect(() => {
    if (hours.data && value === null) setValue(hours.data);
  }, [hours.data, value]);

  const saveHours = useMutation({
    mutationFn: (intervals: WeeklyIntervalDto[]) =>
      api(`${base}/business-hours`, { method: 'PUT', body: { intervals } }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['business-hours', tenantId] }),
        qc.invalidateQueries({ queryKey: ['availability', tenantId] }),
      ]);
      toast.success('Horário de funcionamento salvo');
    },
  });
  const addClosure = useMutation({
    mutationFn: () =>
      api<ClosureDto>(`${base}/closures`, {
        method: 'POST',
        body: {
          kind: closure.kind,
          title: closure.title,
          allDay: true,
          startsAt: DateTime.fromISO(closure.from, { zone: tz }).startOf('day').toISO(),
          endsAt: DateTime.fromISO(closure.to, { zone: tz }).plus({ days: 1 }).startOf('day').toISO(),
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['closures', tenantId] }),
        qc.invalidateQueries({ queryKey: ['availability', tenantId] }),
      ]);
      setClosure({ ...closure, title: '' });
      toast.success('Fechamento registrado');
    },
  });
  const removeClosure = useMutation({
    mutationFn: (id: string) => api(`${base}/closures/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closures', tenantId] }),
  });

  if (!value) return <Skeleton className="h-96 rounded-2xl" />;
  const error = weeklyError(value);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Horário de funcionamento"
          description="A jornada dos profissionais sempre fica dentro deste horário."
        />
        <CardBody>
          <WeeklyHoursEditor value={value} onChange={setValue} />
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          {canManage ? (
            <div className="mt-5 flex justify-end">
              <Button
                disabled={Boolean(error)}
                loading={saveHours.isPending}
                onClick={() => saveHours.mutate(value)}
              >
                Salvar horário
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Feriados e fechamentos"
          description="Datas em que ninguém atende. A recepcionista não oferece horários nesses dias."
        />
        <CardBody className="flex flex-col gap-5">
          {canManage ? (
            <div className="grid gap-3 rounded-2xl bg-ink-50/70 p-4 ring-1 ring-ink-100 sm:grid-cols-[150px_1fr_150px_150px_auto] sm:items-end">
              <Field label="Tipo">
                {(p) => (
                  <Select
                    {...p}
                    value={closure.kind}
                    onChange={(e) => setClosure({ ...closure, kind: e.target.value })}
                  >
                    {Object.entries(CLOSURE_KIND_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Descrição">
                {(p) => (
                  <Input
                    {...p}
                    value={closure.title}
                    onChange={(e) => setClosure({ ...closure, title: e.target.value })}
                    placeholder="Ex.: Natal"
                  />
                )}
              </Field>
              <Field label="De">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={closure.from}
                    onChange={(e) =>
                      setClosure({
                        ...closure,
                        from: e.target.value,
                        to: e.target.value > closure.to ? e.target.value : closure.to,
                      })
                    }
                  />
                )}
              </Field>
              <Field label="Até">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    min={closure.from}
                    value={closure.to}
                    onChange={(e) => setClosure({ ...closure, to: e.target.value })}
                  />
                )}
              </Field>
              <Button
                variant="secondary"
                disabled={closure.title.trim().length < 2}
                loading={addClosure.isPending}
                onClick={() => addClosure.mutate()}
              >
                Adicionar
              </Button>
            </div>
          ) : null}
          {closures.data?.length ? (
            <ul className="divide-y divide-ink-100 rounded-xl ring-1 ring-ink-100">
              {closures.data.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge tone="brass">{CLOSURE_KIND_LABELS[c.kind]}</Badge>
                    <span className="font-medium text-ink-900">{c.title}</span>
                    <span className="text-ink-500">
                      {shortDate(c.startsAt, tz).split(' ')[0]}
                      {DateTime.fromISO(c.endsAt).minus({ minutes: 1 }).setZone(tz).toISODate() !==
                      DateTime.fromISO(c.startsAt).setZone(tz).toISODate()
                        ? ` → ${DateTime.fromISO(c.endsAt).minus({ minutes: 1 }).setZone(tz).toFormat('dd/LL/yyyy')}`
                        : ''}
                    </span>
                  </span>
                  {canManage ? (
                    <button
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-700"
                      aria-label="Remover"
                      onClick={() => removeClosure.mutate(c.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">Nenhum fechamento futuro.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function SchedulingTab({ tenant }: { tenant: TenantDto }) {
  const { base, canManage } = useTenant();
  const invalidate = useInvalidateTenant();
  const [v, setV] = useState({
    slotIntervalMin: tenant.slotIntervalMin,
    minBookingNoticeMin: tenant.minBookingNoticeMin,
    maxBookingDaysAhead: tenant.maxBookingDaysAhead,
    cancellationMinNoticeMin: tenant.cancellationMinNoticeMin,
  });
  const save = useMutation({
    mutationFn: () => api(`${base}`, { method: 'PATCH', body: v }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Regras da agenda salvas');
    },
  });
  const notice = [0, 15, 30, 60, 120, 180, 240, 720, 1440];
  return (
    <Card>
      <CardHeader
        title="Regras da agenda"
        description="Valem para a recepcionista de IA e para o que os clientes podem marcar sozinhos."
      />
      <CardBody className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grade de horários" hint="Intervalo entre os horários oferecidos.">
            {(p) => (
              <Select
                {...p}
                disabled={!canManage}
                value={v.slotIntervalMin}
                onChange={(e) => setV({ ...v, slotIntervalMin: Number(e.target.value) })}
              >
                {[10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    A cada {m} min
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Antecedência mínima para agendar">
            {(p) => (
              <Select
                {...p}
                disabled={!canManage}
                value={v.minBookingNoticeMin}
                onChange={(e) => setV({ ...v, minBookingNoticeMin: Number(e.target.value) })}
              >
                {notice.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'Sem antecedência' : m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Agendar com até">
            {(p) => (
              <Select
                {...p}
                disabled={!canManage}
                value={v.maxBookingDaysAhead}
                onChange={(e) => setV({ ...v, maxBookingDaysAhead: Number(e.target.value) })}
              >
                {[7, 14, 30, 45, 60, 90, 120, 180].map((d) => (
                  <option key={d} value={d}>
                    {d} dias de antecedência
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Cliente cancela/remarca sozinho até"
            hint="Depois disso, a recepcionista encaminha para a equipe."
          >
            {(p) => (
              <Select
                {...p}
                disabled={!canManage}
                value={v.cancellationMinNoticeMin}
                onChange={(e) => setV({ ...v, cancellationMinNoticeMin: Number(e.target.value) })}
              >
                {notice.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'A qualquer momento' : m < 60 ? `${m} min antes` : `${m / 60} h antes`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {canManage ? (
          <div className="flex justify-end">
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Salvar regras
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function AccountTab() {
  const { me } = useSession();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api<{
        sessions: {
          id: string;
          current: boolean;
          userAgent: string | null;
          lastSeenAt: string;
          ip: string | null;
        }[];
      }>('/v1/auth/sessions'),
  });
  const change = useMutation({
    mutationFn: () => api('/v1/auth/password/change', { method: 'POST', body: pw }),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      void sessions.refetch();
      toast.success('Senha alterada. Outras sessões foram encerradas.');
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/v1/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => sessions.refetch(),
  });
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Sua conta" description={`${me.user.name} · ${me.user.email}`} />
        <CardBody className="flex flex-col gap-4">
          {!me.user.emailVerified ? (
            <Notice tone="warning" title="E-mail não confirmado">
              Enviamos um link de confirmação no cadastro.{' '}
              <button
                className="font-medium underline"
                onClick={() =>
                  api('/v1/auth/email/resend', { method: 'POST' })
                    .then(() => toast.success('Link reenviado'))
                    .catch((e) => toast.error(errorMessage(e)))
                }
              >
                Reenviar
              </button>
            </Notice>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Senha atual">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  value={pw.currentPassword}
                  onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                />
              )}
            </Field>
            <Field label="Nova senha" hint="Mínimo de 10 caracteres, com letras e números.">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={pw.newPassword}
                  onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              disabled={!pw.currentPassword || pw.newPassword.length < 10}
              loading={change.isPending}
              onClick={() => change.mutate()}
            >
              Alterar senha
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Sessões ativas"
          description="Encerre o acesso de dispositivos que você não reconhece."
        />
        <CardBody>
          <ul className="divide-y divide-ink-100 rounded-xl ring-1 ring-ink-100">
            {sessions.data?.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Laptop className="size-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-800">
                    {s.userAgent ?? 'Dispositivo desconhecido'}
                  </span>
                  <span className="block text-[13px] text-ink-400">
                    Último acesso {DateTime.fromISO(s.lastSeenAt).setLocale('pt-BR').toRelative()}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </span>
                </span>
                {s.current ? (
                  <Badge tone="success">Esta sessão</Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                    Encerrar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const { tenant } = useTenant();
  const [tab, setTab] = useState<Tab>('estabelecimento');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'estabelecimento', label: 'Estabelecimento' },
    { key: 'horarios', label: 'Horários e feriados' },
    { key: 'agenda', label: 'Regras da agenda' },
    { key: 'conta', label: 'Conta e segurança' },
  ];
  return (
    <>
      <PageHeader title="Configurações" />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-ink-150">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px h-11 border-b-2 px-4 text-sm font-medium whitespace-nowrap transition-colors',
              tab === t.key
                ? 'border-ink-900 text-ink-900'
                : 'border-transparent text-ink-500 hover:text-ink-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!tenant ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : tab === 'estabelecimento' ? (
        <BusinessTab tenant={tenant} />
      ) : tab === 'horarios' ? (
        <HoursTab />
      ) : tab === 'agenda' ? (
        <SchedulingTab tenant={tenant} />
      ) : (
        <AccountTab />
      )}
    </>
  );
}
