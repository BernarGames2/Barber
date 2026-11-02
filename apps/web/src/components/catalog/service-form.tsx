'use client';

import type { PriceType, ServiceDto } from '@barber-voice/contracts';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { centsFromInput, centsToInput } from '@/lib/format';

export interface ServiceFormValue {
  name: string;
  category: string;
  durationMin: number;
  bufferAfterMin: number;
  priceType: PriceType;
  price: string;
  active: boolean;
  bookableByAi: boolean;
}

export const emptyService = (partial: Partial<ServiceFormValue> = {}): ServiceFormValue => ({
  name: '',
  category: '',
  durationMin: 30,
  bufferAfterMin: 0,
  priceType: 'FIXED',
  price: '',
  active: true,
  bookableByAi: true,
  ...partial,
});

export const serviceToForm = (s: ServiceDto): ServiceFormValue => ({
  name: s.name,
  category: s.category ?? '',
  durationMin: s.durationMin,
  bufferAfterMin: s.bufferAfterMin,
  priceType: s.priceType,
  price: centsToInput(s.priceCents),
  active: s.active,
  bookableByAi: s.bookableByAi,
});

export function serviceFormToPayload(v: ServiceFormValue) {
  return {
    name: v.name,
    category: v.category,
    durationMin: v.durationMin,
    bufferAfterMin: v.bufferAfterMin,
    priceType: v.priceType,
    priceCents: v.priceType === 'ON_REQUEST' ? null : centsFromInput(v.price),
    active: v.active,
    bookableByAi: v.bookableByAi,
  };
}

const DURATIONS = [10, 15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240, 300, 360];

/**
 * Formulário de serviço. O preço é SEMPRE digitado pelo estabelecimento:
 * a recepcionista só informa o que estiver cadastrado aqui.
 */
export function ServiceForm({
  initial,
  submitLabel = 'Salvar serviço',
  onSubmit,
  onCancel,
  compact = false,
}: {
  initial: ServiceFormValue;
  submitLabel?: string;
  onSubmit: (payload: ReturnType<typeof serviceFormToPayload>) => Promise<unknown>;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const set = <K extends keyof ServiceFormValue>(k: K, val: ServiceFormValue[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (v.name.trim().length < 2) local.name = 'Informe o nome do serviço';
    if (v.priceType !== 'ON_REQUEST' && centsFromInput(v.price) === null)
      local.priceCents = 'Informe o preço';
    setErrors(local);
    if (Object.keys(local).length) return;
    setLoading(true);
    try {
      await onSubmit(serviceFormToPayload(v));
    } catch (err) {
      if (err instanceof ApiError)
        setErrors({
          ...err.fieldErrors(),
          ...(err.code === 'SERVICE_NAME_EXISTS' ? { name: err.message } : {}),
        });
    } finally {
      setLoading(false);
    }
  }

  const durations = DURATIONS.includes(v.durationMin)
    ? DURATIONS
    : [...DURATIONS, v.durationMin].sort((a, b) => a - b);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <Field label="Nome do serviço" error={errors.name}>
          {(p) => (
            <Input
              {...p}
              value={v.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ex.: Corte + barba"
            />
          )}
        </Field>
        <Field label="Duração" error={errors.durationMin}>
          {(p) => (
            <Select {...p} value={v.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))}>
              {durations.map((d) => (
                <option key={d} value={d}>
                  {d < 60
                    ? `${d} min`
                    : `${Math.floor(d / 60)}h${d % 60 ? String(d % 60).padStart(2, '0') : ''}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de preço">
          {(p) => (
            <Select
              {...p}
              value={v.priceType}
              onChange={(e) => set('priceType', e.target.value as PriceType)}
            >
              <option value="FIXED">Preço fixo</option>
              <option value="STARTING_AT">A partir de</option>
              <option value="ON_REQUEST">Sob consulta</option>
            </Select>
          )}
        </Field>
        {v.priceType !== 'ON_REQUEST' ? (
          <Field label="Preço (R$)" error={errors.priceCents}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                placeholder="0,00"
                value={v.price}
                onChange={(e) => set('price', e.target.value)}
              />
            )}
          </Field>
        ) : (
          <p className="self-end pb-2.5 text-[13px] text-ink-500">
            A recepcionista dirá que o valor é informado pela equipe.
          </p>
        )}
      </div>
      {!compact ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" optional>
            {(p) => (
              <Input
                {...p}
                value={v.category}
                onChange={(e) => set('category', e.target.value)}
                placeholder="Ex.: Cabelo"
              />
            )}
          </Field>
          <Field label="Intervalo após o atendimento" hint="Limpeza/preparo antes do próximo cliente">
            {(p) => (
              <Select
                {...p}
                value={v.bufferAfterMin}
                onChange={(e) => set('bufferAfterMin', Number(e.target.value))}
              >
                {[0, 5, 10, 15, 20, 30].map((b) => (
                  <option key={b} value={b}>
                    {b === 0 ? 'Sem intervalo' : `${b} min`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}
      {!compact ? (
        <div className="flex flex-col gap-3 rounded-xl bg-ink-50 p-4">
          <Switch
            checked={v.active}
            onCheckedChange={(c) => set('active', c)}
            label="Serviço ativo"
            description="Serviços inativos não aparecem para agendamento."
          />
          <Switch
            checked={v.bookableByAi}
            onCheckedChange={(c) => set('bookableByAi', c)}
            label="A recepcionista pode agendar sozinha"
            description="Desative para serviços que exigem avaliação da equipe."
          />
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
