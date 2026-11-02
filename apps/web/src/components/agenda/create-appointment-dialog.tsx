'use client';

import type { AppointmentDto, AvailabilitySlotDto, CustomerDto } from '@barber-voice/contracts';
import { SLOT_REJECTION_LABELS } from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { durationLabel, formatBRL, formatPhoneDisplay, localToIso, timeIn } from '@/lib/format';
import { useAvailability, useCustomers, useProfessionals, useServices } from '@/lib/hooks';
import { useTenant } from '@/lib/session';
import { SlotPicker } from './slot-picker';

export interface CreatePrefill {
  date: string;
  time?: string;
  professionalId?: string;
  customer?: { id: string; name: string };
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function CreateAppointmentDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefill: CreatePrefill;
}) {
  const { base, tenantId, tz, canManage } = useTenant();
  const qc = useQueryClient();
  const services = useServices();
  const professionals = useProfessionals();

  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(prefill.customer ?? null);
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [query, setQuery] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [professionalId, setProfessionalId] = useState(prefill.professionalId ?? '');
  const [date, setDate] = useState(prefill.date);
  const [slot, setSlot] = useState<AvailabilitySlotDto | null>(null);
  const [manual, setManual] = useState(Boolean(prefill.time));
  const [manualTime, setManualTime] = useState(prefill.time ?? '');
  const [isOverbook, setOverbook] = useState(false);
  const [allowOutsideHours, setOutside] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);

  // reinicia ao abrir com novo contexto
  useEffect(() => {
    if (!open) return;
    setCustomer(prefill.customer ?? null);
    setNewCustomer(null);
    setQuery('');
    setServiceIds([]);
    setProfessionalId(prefill.professionalId ?? '');
    setDate(prefill.date);
    setSlot(null);
    setManual(Boolean(prefill.time));
    setManualTime(prefill.time ?? '');
    setOverbook(false);
    setOutside(false);
    setNotes('');
    setError(null);
    setKey(newKey());
  }, [open, prefill]);

  const customers = useCustomers(query);
  const activeServices = services.data?.filter((s) => s.active) ?? [];
  const eligible = useMemo(
    () =>
      (professionals.data ?? []).filter(
        (p) => p.active && serviceIds.every((id) => p.services.some((s) => s.serviceId === id)),
      ),
    [professionals.data, serviceIds],
  );
  useEffect(() => {
    if (professionalId && serviceIds.length && !eligible.some((p) => p.id === professionalId))
      setProfessionalId('');
  }, [eligible, professionalId, serviceIds.length]);

  const availability = useAvailability({
    serviceIds,
    professionalId: professionalId || undefined,
    date,
    enabled: open && !manual,
  });
  useEffect(() => setSlot(null), [serviceIds, professionalId, date]);

  const names = Object.fromEntries((professionals.data ?? []).map((p) => [p.id, p.name]));
  const selectedServices = activeServices.filter((s) => serviceIds.includes(s.id));
  const estimate = selectedServices.reduce((acc, s) => acc + (s.priceCents ?? 0), 0);
  const totalDuration = selectedServices.reduce((acc, s) => acc + s.durationMin, 0);

  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const startsAt = manual ? localToIso(date, manualTime, tz) : slot!.start;
      // "qualquer profissional": a API escolhe no momento da gravação (e tenta o próximo se houver corrida)
      const chosenProfessional = professionalId || undefined;
      return api<AppointmentDto>(`${base}/appointments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          ...(customer
            ? { customerId: customer.id }
            : { newCustomer: { name: newCustomer?.name ?? '', phone: newCustomer?.phone || null } }),
          ...(chosenProfessional ? { professionalId: chosenProfessional } : {}),
          serviceIds,
          startsAt,
          notes: notes || null,
          isOverbook: manual && isOverbook,
          allowOutsideHours: manual && allowOutsideHours,
        },
      });
    },
    onSuccess: async (a) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['appointments', tenantId] }),
        qc.invalidateQueries({ queryKey: ['availability', tenantId] }),
        qc.invalidateQueries({ queryKey: ['dashboard', tenantId] }),
        qc.invalidateQueries({ queryKey: ['customers', tenantId] }),
      ]);
      toast.success(`Agendado: ${a.customer.name}, ${timeIn(a.startsAt, tz)} com ${a.professional.name}`);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SLOT_UNAVAILABLE') {
        const reason = (err.details as { reason?: string } | undefined)?.reason;
        setError(
          `${reason ? (SLOT_REJECTION_LABELS[reason] ?? err.message) : err.message} Escolha outro horário.`,
        );
        setSlot(null);
        void availability.refetch();
        setKey(newKey()); // nova tentativa = nova intenção
      } else setError(err instanceof Error ? err.message : 'Não foi possível agendar.');
    },
  });

  const hasCustomer = Boolean(customer) || Boolean(newCustomer && newCustomer.name.trim().length >= 2);
  const hasTime = manual ? /^\d{2}:\d{2}$/.test(manualTime) : Boolean(slot);
  const canSubmit = hasCustomer && serviceIds.length > 0 && hasTime && !create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Novo agendamento"
      description="Os horários exibidos vêm da agenda real e são revalidados no momento de salvar."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => create.mutate()} disabled={!canSubmit} loading={create.isPending}>
            Confirmar agendamento
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 pb-2">
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {/* cliente */}
        <section>
          <p className="mb-2 text-[13px] font-medium text-ink-700">Cliente</p>
          {customer ? (
            <div className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3 ring-1 ring-ink-100">
              <span className="text-sm font-medium text-ink-900">{customer.name}</span>
              <button
                className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
                onClick={() => setCustomer(null)}
              >
                Trocar
              </button>
            </div>
          ) : newCustomer ? (
            <div className="grid gap-3 rounded-xl bg-ink-50/60 p-4 ring-1 ring-ink-100 sm:grid-cols-2">
              <Field label="Nome">
                {(p) => (
                  <Input
                    {...p}
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Telefone" optional hint="Evita cadastro duplicado.">
                {(p) => (
                  <Input
                    {...p}
                    type="tel"
                    inputMode="tel"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  />
                )}
              </Field>
              <button
                className="text-left text-[13px] font-medium text-ink-500 hover:text-ink-900 sm:col-span-2"
                onClick={() => setNewCustomer(null)}
              >
                Buscar cliente existente
              </button>
            </div>
          ) : (
            <div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400" />
                <Input
                  className="pl-10"
                  placeholder="Buscar por nome ou telefone"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="mt-2 overflow-hidden rounded-xl ring-1 ring-ink-100">
                {(customers.data?.customers ?? []).slice(0, 5).map((c: CustomerDto) => (
                  <button
                    key={c.id}
                    className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-2.5 text-left last:border-0 hover:bg-ink-50"
                    onClick={() => setCustomer({ id: c.id, name: c.name })}
                  >
                    <span className="text-sm text-ink-900">{c.name}</span>
                    <span className="text-[13px] text-ink-400">{formatPhoneDisplay(c.phone)}</span>
                  </button>
                ))}
                <button
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-ink-700 hover:bg-ink-50"
                  onClick={() =>
                    setNewCustomer({
                      name: query.replace(/[\d()+-]/g, '').trim(),
                      phone: /\d{4,}/.test(query) ? query : '',
                    })
                  }
                >
                  <UserPlus className="size-4" /> Novo cliente{query ? `: “${query}”` : ''}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* serviços */}
        <section>
          <p className="mb-2 text-[13px] font-medium text-ink-700">Serviços</p>
          <div className="flex flex-wrap gap-2">
            {activeServices.map((s) => {
              const on = serviceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setServiceIds(on ? serviceIds.filter((id) => id !== s.id) : [...serviceIds, s.id])
                  }
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-[13px] ring-1 transition-colors',
                    on
                      ? 'bg-ink-900 text-paper ring-ink-900'
                      : 'bg-white text-ink-700 ring-ink-200 hover:ring-ink-400',
                  )}
                >
                  {s.name} · {durationLabel(s.durationMin)}
                </button>
              );
            })}
          </div>
          {selectedServices.length ? (
            <p className="mt-2 text-[13px] text-ink-500">
              Duração padrão {durationLabel(totalDuration)} · referência {formatBRL(estimate)}
              {selectedServices.some((s) => s.priceType !== 'FIXED') ? ' (contém preço variável)' : ''}.
              Valores finais seguem o profissional.
            </p>
          ) : null}
        </section>

        {/* profissional e data */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Profissional">
            {(p) => (
              <Select {...p} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">Qualquer profissional disponível</option>
                {eligible.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Data">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            )}
          </Field>
        </section>

        {/* horário */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-700">Horário</p>
            <button
              className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
              onClick={() => setManual(!manual)}
            >
              {manual ? 'Ver horários livres' : 'Digitar horário'}
            </button>
          </div>
          {serviceIds.length === 0 ? (
            <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-500">
              Escolha os serviços para ver os horários livres.
            </p>
          ) : manual ? (
            <div className="flex flex-col gap-3">
              <Input
                type="time"
                step={300}
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
                className="w-36"
              />
              <Checkbox
                checked={isOverbook}
                onChange={(e) => setOverbook(e.target.checked)}
                label="Encaixe"
                description="Permite sobrepor outro atendimento do mesmo profissional."
              />
              {canManage ? (
                <Checkbox
                  checked={allowOutsideHours}
                  onChange={(e) => setOutside(e.target.checked)}
                  label="Fora do horário de funcionamento"
                  description="Exceção autorizada por gestor (fica registrada na auditoria)."
                />
              ) : null}
            </div>
          ) : (
            <SlotPicker
              slots={availability.data?.slots}
              loading={availability.isFetching && !availability.data}
              error={availability.error?.message ?? null}
              tz={tz}
              value={slot?.start ?? null}
              onChange={setSlot}
              professionalNames={names}
            />
          )}
          {slot && !professionalId ? (
            <p className="mt-3 text-[13px] text-ink-500">
              Livre com:{' '}
              {slot.professionalIds
                .map((id) => names[id])
                .filter(Boolean)
                .join(', ')}
              . O sistema distribui para quem estiver menos ocupado no dia.
            </p>
          ) : null}
        </section>

        <Field label="Observações" optional>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: prefere máquina 2 nas laterais"
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
