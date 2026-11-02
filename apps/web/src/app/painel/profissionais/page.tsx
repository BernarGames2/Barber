'use client';

import type { ProfessionalDto, TimeOffDto, WeeklyIntervalDto } from '@barber-voice/contracts';
import { TIME_OFF_KIND_LABELS } from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Plus, Trash2, UserRound } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { WeeklyHoursEditor, weeklyError } from '@/components/schedule/weekly-hours-editor';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Notice, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { centsFromInput, centsToInput, initials, localToIso, shortDate, todayIn } from '@/lib/format';
import { useBusinessHours, useProfessionals, useServices, useTimeOff } from '@/lib/hooks';
import { useTenant } from '@/lib/session';

type Tab = 'dados' | 'servicos' | 'jornada' | 'folgas';
const COLORS = ['#b8892f', '#2f6f5e', '#7c3aed', '#c2410c', '#2563eb', '#be185d', '#475569'];

function ProfessionalEditor({
  professional,
  onClose,
}: {
  professional: ProfessionalDto | 'new';
  onClose: () => void;
}) {
  const { base, tenantId, tz } = useTenant();
  const qc = useQueryClient();
  const services = useServices();
  const business = useBusinessHours();
  const isNew = professional === 'new';
  const p = isNew ? null : professional;
  const [tab, setTab] = useState<Tab>('dados');
  const [info, setInfo] = useState({
    name: p?.name ?? '',
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    bio: p?.bio ?? '',
    color: p?.color ?? COLORS[0]!,
    active: p?.active ?? true,
    bookableByAi: p?.bookableByAi ?? true,
  });
  const [links, setLinks] = useState<Record<string, { on: boolean; duration: string; price: string }>>({});
  const [inherit, setInherit] = useState(p?.usesBusinessHours ?? true);
  const [hours, setHours] = useState<WeeklyIntervalDto[]>(p?.workingHours ?? []);
  const [off, setOff] = useState({
    kind: 'BLOCK',
    date: todayIn(tz),
    start: '12:00',
    end: '13:00',
    allDay: false,
    endDate: todayIn(tz),
    reason: '',
  });
  const [conflicts, setConflicts] = useState<{ id: string; startsAt: string; customerName: string }[] | null>(
    null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!services.data) return;
    setLinks(
      Object.fromEntries(
        services.data.map((s) => {
          const l = p?.services.find((x) => x.serviceId === s.id);
          return [
            s.id,
            {
              on: isNew ? true : Boolean(l),
              duration: l?.durationMin ? String(l.durationMin) : '',
              price: centsToInput(l?.priceCents),
            },
          ];
        }),
      ),
    );
  }, [services.data, p, isNew]);
  useEffect(() => {
    if (inherit || hours.length || !business.data) return;
    setHours(business.data);
  }, [inherit, hours.length, business.data]);

  const range = {
    from: DateTime.now().setZone(tz).startOf('day').toISO()!,
    to: DateTime.now().setZone(tz).plus({ days: 120 }).toISO()!,
  };
  const timeOff = useTimeOff(range.from, range.to);
  const myOff = (timeOff.data ?? []).filter((t: TimeOffDto) => p && t.professionalId === p.id);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['professionals', tenantId] }),
      qc.invalidateQueries({ queryKey: ['availability', tenantId] }),
      qc.invalidateQueries({ queryKey: ['time-off', tenantId] }),
    ]);

  const servicePayload = () =>
    Object.entries(links)
      .filter(([, v]) => v.on)
      .map(([serviceId, v]) => ({
        serviceId,
        durationMin: v.duration ? Number(v.duration) : null,
        priceCents: v.price ? centsFromInput(v.price) : null,
      }));

  const save = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const body = { ...info, phone: info.phone, email: info.email, bio: info.bio };
      if (isNew) {
        const created = await api<ProfessionalDto>(`${base}/professionals`, {
          method: 'POST',
          body: {
            ...body,
            serviceIds: servicePayload().map((s) => s.serviceId),
            workingHours: inherit ? null : hours,
          },
        });
        await api(`${base}/professionals/${created.id}/services`, {
          method: 'PUT',
          body: { services: servicePayload() },
        });
        return created;
      }
      await api(`${base}/professionals/${p!.id}`, { method: 'PATCH', body });
      await api(`${base}/professionals/${p!.id}/services`, {
        method: 'PUT',
        body: { services: servicePayload() },
      });
      return api<ProfessionalDto>(`${base}/professionals/${p!.id}/schedule`, {
        method: 'PUT',
        body: { workingHours: inherit ? null : hours },
      });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success('Profissional salvo');
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        toast.error(err.message);
      }
    },
  });

  const addOff = useMutation({
    meta: { silent: true },
    mutationFn: (force: boolean) =>
      api(`${base}/time-off${force ? '?force=true' : ''}`, {
        method: 'POST',
        body: {
          professionalId: p!.id,
          kind: off.kind,
          reason: off.reason,
          startsAt: localToIso(off.date, off.allDay ? '00:00' : off.start, tz),
          endsAt: off.allDay
            ? DateTime.fromISO(off.endDate, { zone: tz }).plus({ days: 1 }).startOf('day').toISO()!
            : localToIso(off.date, off.end, tz),
        },
      }),
    onSuccess: async () => {
      setConflicts(null);
      await invalidate();
      toast.success('Bloqueio registrado');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'TIME_OFF_CONFLICTS') {
        setConflicts(
          (err.details as { appointments: { id: string; startsAt: string; customerName: string }[] })
            .appointments,
        );
      } else toast.error(err instanceof Error ? err.message : 'Erro ao bloquear');
    },
  });

  const removeOff = useMutation({
    mutationFn: (id: string) => api(`${base}/time-off/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const hoursError = !inherit ? weeklyError(hours) : null;
  const tabs: { key: Tab; label: string; disabled?: boolean }[] = [
    { key: 'dados', label: 'Dados' },
    { key: 'servicos', label: 'Serviços' },
    { key: 'jornada', label: 'Jornada' },
    { key: 'folgas', label: 'Folgas e bloqueios', disabled: isNew },
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Novo profissional' : p!.name}
      size="lg"
      footer={
        tab !== 'folgas' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              disabled={info.name.trim().length < 2 || Boolean(hoursError)}
              onClick={() => save.mutate()}
            >
              Salvar
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-ink-50 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            disabled={t.disabled}
            onClick={() => setTab(t.key)}
            className={cn(
              'h-9 flex-1 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-40',
              tab === t.key ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dados' ? (
        <div className="flex flex-col gap-4 pb-2">
          <Field label="Nome" error={errors.name}>
            {(pp) => (
              <Input {...pp} value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Telefone" optional error={errors.phone}>
              {(pp) => (
                <Input
                  {...pp}
                  type="tel"
                  value={info.phone}
                  onChange={(e) => setInfo({ ...info, phone: e.target.value })}
                />
              )}
            </Field>
            <Field label="E-mail" optional error={errors.email}>
              {(pp) => (
                <Input
                  {...pp}
                  type="email"
                  value={info.email}
                  onChange={(e) => setInfo({ ...info, email: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">Cor na agenda</p>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  onClick={() => setInfo({ ...info, color: c })}
                  className={cn(
                    'size-8 rounded-full ring-offset-2',
                    info.color === c && 'ring-2 ring-ink-900',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-xl bg-ink-50 p-4">
            <Switch
              checked={info.active}
              onCheckedChange={(v) => setInfo({ ...info, active: v })}
              label="Ativo"
              description="Inativos não recebem agendamentos."
            />
            <Switch
              checked={info.bookableByAi}
              onCheckedChange={(v) => setInfo({ ...info, bookableByAi: v })}
              label="A recepcionista pode agendar com este profissional"
            />
          </div>
        </div>
      ) : null}

      {tab === 'servicos' ? (
        <div className="flex flex-col gap-2 pb-2">
          <p className="mb-2 text-[13px] text-ink-500">
            Duração e preço próprios são opcionais — vazios seguem o padrão do serviço.
          </p>
          {services.data?.map((s) => {
            const l = links[s.id] ?? { on: false, duration: '', price: '' };
            return (
              <div
                key={s.id}
                className="flex flex-col gap-3 rounded-xl px-3 py-3 ring-1 ring-ink-100 sm:flex-row sm:items-center"
              >
                <Checkbox
                  className="flex-1"
                  checked={l.on}
                  onChange={(e) => setLinks({ ...links, [s.id]: { ...l, on: e.target.checked } })}
                  label={s.name}
                />
                {l.on ? (
                  <div className="flex gap-2">
                    <Input
                      className="w-28"
                      inputMode="numeric"
                      placeholder={`${s.durationMin} min`}
                      aria-label={`Duração de ${s.name}`}
                      value={l.duration}
                      onChange={(e) =>
                        setLinks({ ...links, [s.id]: { ...l, duration: e.target.value.replace(/\D/g, '') } })
                      }
                    />
                    {s.priceType !== 'ON_REQUEST' ? (
                      <Input
                        className="w-28"
                        inputMode="decimal"
                        placeholder={centsToInput(s.priceCents)}
                        aria-label={`Preço de ${s.name}`}
                        value={l.price}
                        onChange={(e) => setLinks({ ...links, [s.id]: { ...l, price: e.target.value } })}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === 'jornada' ? (
        <div className="flex flex-col gap-4 pb-2">
          <Switch
            checked={inherit}
            onCheckedChange={setInherit}
            label="Segue o horário de funcionamento"
            description="Desative para definir dias e horários próprios (sempre dentro do horário do estabelecimento)."
          />
          {!inherit ? (
            <>
              <WeeklyHoursEditor value={hours} onChange={setHours} />
              {hoursError ? <p className="text-sm text-rose-700">{hoursError}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'folgas' && p ? (
        <div className="flex flex-col gap-5 pb-2">
          <div className="grid gap-3 rounded-2xl bg-ink-50/70 p-4 ring-1 ring-ink-100 sm:grid-cols-2">
            <Field label="Tipo">
              {(pp) => (
                <Select {...pp} value={off.kind} onChange={(e) => setOff({ ...off, kind: e.target.value })}>
                  {Object.entries(TIME_OFF_KIND_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Motivo" optional>
              {(pp) => (
                <Input
                  {...pp}
                  value={off.reason}
                  onChange={(e) => setOff({ ...off, reason: e.target.value })}
                />
              )}
            </Field>
            <Field label={off.allDay ? 'De' : 'Data'}>
              {(pp) => (
                <Input
                  {...pp}
                  type="date"
                  value={off.date}
                  onChange={(e) =>
                    setOff({
                      ...off,
                      date: e.target.value,
                      endDate: e.target.value > off.endDate ? e.target.value : off.endDate,
                    })
                  }
                />
              )}
            </Field>
            {off.allDay ? (
              <Field label="Até">
                {(pp) => (
                  <Input
                    {...pp}
                    type="date"
                    value={off.endDate}
                    min={off.date}
                    onChange={(e) => setOff({ ...off, endDate: e.target.value })}
                  />
                )}
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Início">
                  {(pp) => (
                    <Input
                      {...pp}
                      type="time"
                      step={300}
                      value={off.start}
                      onChange={(e) => setOff({ ...off, start: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Fim">
                  {(pp) => (
                    <Input
                      {...pp}
                      type="time"
                      step={300}
                      value={off.end}
                      onChange={(e) => setOff({ ...off, end: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            )}
            <Checkbox
              className="sm:col-span-2"
              checked={off.allDay}
              onChange={(e) => setOff({ ...off, allDay: e.target.checked })}
              label="Dia(s) inteiro(s)"
            />
            {conflicts ? (
              <Notice
                tone="warning"
                className="sm:col-span-2"
                title={`${conflicts.length} agendamento(s) neste período`}
              >
                <ul className="mt-1 list-disc pl-5">
                  {conflicts.map((c) => (
                    <li key={c.id}>
                      {shortDate(c.startsAt, tz)} — {c.customerName}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">Remarque esses clientes ou confirme o bloqueio mesmo assim.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => addOff.mutate(true)}
                  loading={addOff.isPending}
                >
                  Bloquear mesmo assim
                </Button>
              </Notice>
            ) : null}
            <div className="sm:col-span-2">
              <Button variant="secondary" loading={addOff.isPending} onClick={() => addOff.mutate(false)}>
                <CalendarOff className="size-4" /> Registrar bloqueio
              </Button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">Próximos bloqueios</p>
            {myOff.length === 0 ? (
              <p className="text-sm text-ink-400">Nenhum bloqueio futuro.</p>
            ) : (
              <ul className="divide-y divide-ink-100 rounded-xl ring-1 ring-ink-100">
                {myOff.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>
                      <Badge tone="neutral">{TIME_OFF_KIND_LABELS[t.kind]}</Badge>{' '}
                      <span className="text-ink-700">
                        {shortDate(t.startsAt, tz)} → {shortDate(t.endsAt, tz)}
                      </span>
                      {t.reason ? <span className="text-ink-400"> · {t.reason}</span> : null}
                    </span>
                    <button
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-700"
                      aria-label="Remover bloqueio"
                      onClick={() => removeOff.mutate(t.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

export default function ProfessionalsPage() {
  const { canManage } = useTenant();
  const { data, isPending } = useProfessionals();
  const services = useServices();
  const [editing, setEditing] = useState<ProfessionalDto | 'new' | null>(null);
  const serviceName = Object.fromEntries((services.data ?? []).map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader
        title="Profissionais"
        description="Quem atende, quais serviços faz e quando trabalha."
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Novo profissional
            </Button>
          ) : null
        }
      />
      {isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<UserRound className="size-5" />} title="Nenhum profissional cadastrado" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <button
              key={p.id}
              onClick={() => canManage && setEditing(p)}
              className="rounded-2xl bg-white p-5 text-left shadow-card transition-shadow hover:shadow-pop disabled:cursor-default"
              disabled={!canManage}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex size-11 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: p.color ?? '#b8892f' }}
                >
                  {initials(p.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink-900">{p.name}</p>
                  <p className="text-[13px] text-ink-500">
                    {p.usesBusinessHours ? 'Horário do estabelecimento' : 'Jornada própria'}
                  </p>
                </div>
                {!p.active ? <Badge>Inativo</Badge> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.services.slice(0, 6).map((s) => (
                  <Badge key={s.serviceId} tone="neutral">
                    {serviceName[s.serviceId] ?? 'Serviço'}
                  </Badge>
                ))}
                {p.services.length > 6 ? <Badge>+{p.services.length - 6}</Badge> : null}
                {p.services.length === 0 ? <Badge tone="warning">Sem serviços</Badge> : null}
              </div>
            </button>
          ))}
        </div>
      )}
      {editing ? <ProfessionalEditor professional={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
