'use client';

import { BRAZIL_STATES, BUSINESS_CATEGORIES, CATEGORY_LABELS, type TenantDto } from '@barber-voice/contracts';
import { BRAZIL_TIMEZONES, formatPhoneDisplay } from '@barber-voice/core';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ApiError } from '@/lib/api';

export interface BusinessFormValue {
  name: string;
  category: string;
  responsibleName: string;
  phone: string;
  whatsappNumber: string;
  email: string;
  timezone: string;
  addressPostalCode: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
}

export function tenantToForm(t?: TenantDto | null, responsibleName = ''): BusinessFormValue {
  return {
    name: t?.name ?? '',
    category: t?.category ?? 'BARBERSHOP',
    responsibleName: t?.responsibleName ?? responsibleName,
    phone: t?.phone ? formatPhoneDisplay(t.phone) : '',
    whatsappNumber: t?.whatsappNumber ? formatPhoneDisplay(t.whatsappNumber) : '',
    email: t?.email ?? '',
    timezone: t?.timezone ?? 'America/Sao_Paulo',
    addressPostalCode: t?.addressPostalCode ?? '',
    addressStreet: t?.addressStreet ?? '',
    addressNumber: t?.addressNumber ?? '',
    addressComplement: t?.addressComplement ?? '',
    addressDistrict: t?.addressDistrict ?? '',
    addressCity: t?.addressCity ?? '',
    addressState: t?.addressState ?? '',
  };
}

export function BusinessForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: BusinessFormValue;
  submitLabel: string;
  onSubmit: (v: BusinessFormValue) => Promise<unknown>;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const set = (k: keyof BusinessFormValue, val: string) => setV((p) => ({ ...p, [k]: val }));
  const err = (k: string) => errors[k];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      await onSubmit(v);
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <Field label="Nome do estabelecimento" error={err('name')}>
          {(p) => (
            <Input
              {...p}
              value={v.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ex.: Barbearia Navalha de Ouro"
            />
          )}
        </Field>
        <Field label="Categoria" error={err('category')}>
          {(p) => (
            <Select {...p} value={v.category} onChange={(e) => set('category', e.target.value)}>
              {BUSINESS_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do responsável" error={err('responsibleName')}>
          {(p) => (
            <Input
              {...p}
              value={v.responsibleName}
              onChange={(e) => set('responsibleName', e.target.value)}
              autoComplete="name"
            />
          )}
        </Field>
        <Field label="E-mail do estabelecimento" optional error={err('email')}>
          {(p) => (
            <Input {...p} type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Telefone de atendimento"
          error={err('phone')}
          hint="Com DDD. É o número que os clientes ligam."
        >
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              value={v.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="(11) 3456-7890"
            />
          )}
        </Field>
        <Field label="WhatsApp" optional error={err('whatsappNumber')} hint="Pode ser o mesmo número.">
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              value={v.whatsappNumber}
              onChange={(e) => set('whatsappNumber', e.target.value)}
              placeholder="(11) 98765-4321"
            />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-2xl bg-ink-50/70 p-4 ring-1 ring-ink-100 sm:p-5">
        <legend className="px-1 text-[13px] font-medium text-ink-600">Endereço</legend>
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <Field label="CEP" optional error={err('addressPostalCode')}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={v.addressPostalCode}
                onChange={(e) => set('addressPostalCode', e.target.value)}
                placeholder="00000-000"
              />
            )}
          </Field>
          <Field label="Rua" optional error={err('addressStreet')}>
            {(p) => (
              <Input
                {...p}
                value={v.addressStreet}
                onChange={(e) => set('addressStreet', e.target.value)}
                autoComplete="address-line1"
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[120px_1fr_1fr]">
          <Field label="Número" optional>
            {(p) => (
              <Input {...p} value={v.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} />
            )}
          </Field>
          <Field label="Complemento" optional>
            {(p) => (
              <Input
                {...p}
                value={v.addressComplement}
                onChange={(e) => set('addressComplement', e.target.value)}
              />
            )}
          </Field>
          <Field label="Bairro" optional>
            {(p) => (
              <Input
                {...p}
                value={v.addressDistrict}
                onChange={(e) => set('addressDistrict', e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="Cidade" optional>
            {(p) => (
              <Input
                {...p}
                value={v.addressCity}
                onChange={(e) => set('addressCity', e.target.value)}
                autoComplete="address-level2"
              />
            )}
          </Field>
          <Field label="UF" optional error={err('addressState')}>
            {(p) => (
              <Select {...p} value={v.addressState} onChange={(e) => set('addressState', e.target.value)}>
                <option value="">—</option>
                {BRAZIL_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </fieldset>

      <Field
        label="Fuso horário"
        hint="Usado para horários da agenda e da recepcionista."
        error={err('timezone')}
      >
        {(p) => (
          <Select {...p} value={v.timezone} onChange={(e) => set('timezone', e.target.value)}>
            {BRAZIL_TIMEZONES.map((tz) => (
              <option key={tz.id} value={tz.id}>
                {tz.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
