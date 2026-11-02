'use client';

import type { AppointmentDto, AvailabilitySlotDto } from '@barber-voice/contracts';
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  SLOT_REJECTION_LABELS,
} from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Phone, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Notice } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { ApiError, api } from '@/lib/api';
import { dateIn, durationLabel, formatPhoneDisplay, longDate, priceLabel, timeIn } from '@/lib/format';
import { useAvailability } from '@/lib/hooks';
import { useTenant } from '@/lib/session';
import { SlotPicker } from './slot-picker';

export const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'brass' | 'neutral'> = {
  CONFIRMED: 'info',
  PENDING: 'warning',
  HELD: 'brass',
  COMPLETED: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

type Mode = 'view' | 'cancel' | 'reschedule';

export function AppointmentDetailsDialog({
  appointment,
  onOpenChange,
}: {
  appointment: AppointmentDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { base, tenantId, tz } = useTenant();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('view');
  const [reason, setReason] = useState('');
  const [cancelledBy, setCancelledBy] = useState<'CUSTOMER' | 'STAFF'>('CUSTOMER');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState<AvailabilitySlotDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appointment) return;
    setMode('view');
    setReason('');
    setCancelledBy('CUSTOMER');
    setDate(dateIn(appointment.startsAt, tz));
    setSlot(null);
    setError(null);
  }, [appointment, tz]);

  const availability = useAvailability({
    serviceIds: appointment?.items.map((i) => i.serviceId) ?? [],
    professionalId: appointment?.professional.id,
    date,
    enabled: mode === 'reschedule' && Boolean(appointment),
    excludeAppointmentId: appointment?.id,
  });

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['appointments', tenantId] }),
      qc.invalidateQueries({ queryKey: ['availability', tenantId] }),
      qc.invalidateQueries({ queryKey: ['dashboard', tenantId] }),
      qc.invalidateQueries({ queryKey: ['customer', tenantId] }),
    ]);

  const action = useMutation({
    meta: { silent: true },
    mutationFn: (fn: () => Promise<AppointmentDto>) => fn(),
    onSuccess: async (_a, _fn) => {
      await refresh();
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SLOT_UNAVAILABLE') {
        const r = (err.details as { reason?: string } | undefined)?.reason;
        setError(r ? (SLOT_REJECTION_LABELS[r] ?? err.message) : err.message);
        setSlot(null);
        void availability.refetch();
      } else setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
    },
  });

  if (!appointment) return null;
  const a = appointment;
  const started = new Date(a.startsAt).getTime() <= Date.now();
  const active = ['CONFIRMED', 'PENDING', 'HELD'].includes(a.status);
  const run = (fn: () => Promise<AppointmentDto>, success: string) =>
    action.mutate(async () => {
      const r = await fn();
      toast.success(success);
      return r;
    });
  const setStatus = (status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW', msg: string) =>
    run(
      () => api<AppointmentDto>(`${base}/appointments/${a.id}/status`, { method: 'POST', body: { status } }),
      msg,
    );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={a.customer.name}
      description={`${longDate(dateIn(a.startsAt, tz))} · ${timeIn(a.startsAt, tz)}–${timeIn(a.endsAt, tz)}`}
      footer={
        mode === 'view' ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            {active ? (
              <>
                <Button variant="danger-ghost" onClick={() => setMode('cancel')}>
                  Cancelar
                </Button>
                <Button variant="secondary" onClick={() => setMode('reschedule')}>
                  <CalendarClock className="size-4" /> Remarcar
                </Button>
              </>
            ) : null}
            {a.status === 'PENDING' || a.status === 'HELD' ? (
              <Button
                variant="secondary"
                loading={action.isPending}
                onClick={() => setStatus('CONFIRMED', 'Agendamento confirmado')}
              >
                Confirmar
              </Button>
            ) : null}
            {(a.status === 'CONFIRMED' || a.status === 'PENDING') && started ? (
              <>
                <Button
                  variant="secondary"
                  loading={action.isPending}
                  onClick={() => setStatus('NO_SHOW', 'Falta registrada')}
                >
                  Não compareceu
                </Button>
                <Button
                  loading={action.isPending}
                  onClick={() => setStatus('COMPLETED', 'Atendimento concluído')}
                >
                  Concluir atendimento
                </Button>
              </>
            ) : null}
          </div>
        ) : mode === 'cancel' ? (
          <>
            <Button variant="ghost" onClick={() => setMode('view')}>
              Voltar
            </Button>
            <Button
              variant="danger"
              loading={action.isPending}
              onClick={() =>
                run(
                  () =>
                    api<AppointmentDto>(`${base}/appointments/${a.id}/cancel`, {
                      method: 'POST',
                      body: { reason: reason || null, cancelledBy },
                    }),
                  'Agendamento cancelado',
                )
              }
            >
              Confirmar cancelamento
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode('view')}>
              Voltar
            </Button>
            <Button
              disabled={!slot}
              loading={action.isPending}
              onClick={() =>
                run(
                  () =>
                    api<AppointmentDto>(`${base}/appointments/${a.id}/reschedule`, {
                      method: 'POST',
                      body: { startsAt: slot!.start },
                    }),
                  'Agendamento remarcado',
                )
              }
            >
              Remarcar para {slot ? timeIn(slot.start, tz) : '…'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
          <Badge tone="neutral">{APPOINTMENT_SOURCE_LABELS[a.source]}</Badge>
          {a.isOverbook ? <Badge tone="warning">Encaixe</Badge> : null}
        </div>

        {mode === 'view' ? (
          <>
            <div className="grid gap-3 rounded-2xl bg-ink-50/70 p-4 ring-1 ring-ink-100 sm:grid-cols-2">
              <p className="flex items-center gap-2 text-sm text-ink-700">
                <UserRound className="size-4 text-ink-400" /> {a.professional.name}
              </p>
              {a.customer.phone ? (
                <a
                  href={`tel:${a.customer.phone}`}
                  className="flex items-center gap-2 text-sm text-ink-700 hover:text-ink-900"
                >
                  <Phone className="size-4 text-ink-400" /> {formatPhoneDisplay(a.customer.phone)}
                </a>
              ) : null}
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-700">Serviços</p>
              <ul className="divide-y divide-ink-100 rounded-xl ring-1 ring-ink-100">
                {a.items.map((i) => (
                  <li key={i.serviceId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-ink-900">
                      {i.serviceName} <span className="text-ink-400">· {durationLabel(i.durationMin)}</span>
                    </span>
                    <span className="text-ink-700">{priceLabel(i.priceCents, i.priceType)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-right text-[13px] text-ink-500">
                Total{' '}
                {a.totalPriceCents !== null
                  ? priceLabel(a.totalPriceCents, a.priceIsEstimate ? 'STARTING_AT' : 'FIXED')
                  : 'sob consulta'}
              </p>
            </div>
            {a.notes ? (
              <p className="rounded-xl bg-brass-50 px-4 py-3 text-sm text-brass-800">{a.notes}</p>
            ) : null}
            {a.cancelReason ? (
              <p className="text-sm text-ink-500">Motivo do cancelamento: {a.cancelReason}</p>
            ) : null}
            <Link
              href={`/painel/clientes/${a.customer.id}`}
              className="text-sm font-medium text-ink-700 underline underline-offset-4"
            >
              Ver ficha do cliente
            </Link>
          </>
        ) : null}

        {mode === 'cancel' ? (
          <div className="flex flex-col gap-4">
            <Field label="Quem cancelou?">
              {(p) => (
                <Select
                  {...p}
                  value={cancelledBy}
                  onChange={(e) => setCancelledBy(e.target.value as 'CUSTOMER' | 'STAFF')}
                >
                  <option value="CUSTOMER">O cliente</option>
                  <option value="STAFF">O estabelecimento</option>
                </Select>
              )}
            </Field>
            <Field label="Motivo" optional>
              {(p) => (
                <Input
                  {...p}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: imprevisto no trabalho"
                />
              )}
            </Field>
            <p className="text-[13px] text-ink-500">O horário volta a ficar disponível imediatamente.</p>
          </div>
        ) : null}

        {mode === 'reschedule' ? (
          <div className="flex flex-col gap-4">
            <Field label="Nova data">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                />
              )}
            </Field>
            <SlotPicker
              slots={availability.data?.slots}
              loading={availability.isFetching && !availability.data}
              error={availability.error?.message ?? null}
              tz={tz}
              value={slot?.start ?? null}
              onChange={setSlot}
            />
            <p className="text-[13px] text-ink-500">
              A remarcação é atômica: se o novo horário for ocupado no meio do caminho, o horário original é
              mantido.
            </p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
