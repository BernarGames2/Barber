'use client';

import type {
  OnboardingStep,
  ProfessionalDto,
  ServiceDto,
  TenantDto,
  WeeklyIntervalDto,
} from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleDashed, Plus, Scissors, Trash2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BrandLoader } from '@/components/brand/brand-loader';
import { Logo } from '@/components/brand/logo';
import { ServiceForm, emptyService } from '@/components/catalog/service-form';
import { SERVICE_SUGGESTIONS } from '@/components/catalog/service-suggestions';
import { SUGGESTED_HOURS, WeeklyHoursEditor, weeklyError } from '@/components/schedule/weekly-hours-editor';
import { BusinessForm, type BusinessFormValue, tenantToForm } from '@/components/tenant/business-form';
import { Button } from '@/components/ui/button';
import { Badge, Card, Notice } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { durationLabel, priceLabel } from '@/lib/format';
import { useBusinessHours, useOnboarding, useProfessionals, useServices } from '@/lib/hooks';
import { SessionGate, useMe, useSession, useTenant } from '@/lib/session';

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: 'business', label: 'Estabelecimento' },
  { key: 'hours', label: 'Horários' },
  { key: 'services', label: 'Serviços' },
  { key: 'professionals', label: 'Profissionais' },
  { key: 'review', label: 'Revisão' },
];

function Frame({ step, children }: { step: OnboardingStep; children: ReactNode }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-ink-150 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Logo />
          <Link href="/painel" className="text-sm text-ink-500 hover:text-ink-900">
            Ir para o painel
          </Link>
        </div>
        <ol className="mx-auto flex max-w-3xl gap-1.5 px-5 pb-4" aria-label="Etapas da configuração">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex-1">
              <div className={cn('h-1 rounded-full', i <= idx ? 'bg-brass-500' : 'bg-ink-150')} />
              <p
                className={cn(
                  'mt-2 hidden text-xs sm:block',
                  i === idx ? 'font-medium text-ink-900' : 'text-ink-400',
                )}
              >
                {s.label}
              </p>
            </li>
          ))}
        </ol>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <p className="text-sm font-medium text-brass-700">
          Etapa {idx + 1} de {STEPS.length}
        </p>
        <div className="mt-2 animate-rise">{children}</div>
      </main>
    </div>
  );
}

function StepTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-4xl tracking-tight sm:text-[44px]">{title}</h1>
      <p className="mt-2 max-w-xl text-[15px] text-ink-500">{description}</p>
    </div>
  );
}

// ------------------------------------------------------------------ etapa 1
function BusinessStep({ onCreated }: { onCreated: (t: TenantDto) => void }) {
  const me = useMe();
  return (
    <Frame step="business">
      <StepTitle
        title="Seu estabelecimento"
        description="Estes dados aparecem para os clientes e orientam a recepcionista. Você pode alterá-los depois."
      />
      <Card className="p-5 sm:p-7">
        <BusinessForm
          initial={tenantToForm(null, me.data?.user.name ?? '')}
          submitLabel="Continuar"
          onSubmit={async (v: BusinessFormValue) => {
            try {
              const t = await api<TenantDto>('/v1/tenants', { method: 'POST', body: v });
              onCreated(t);
            } catch (err) {
              toast.error(errorMessage(err));
              throw err;
            }
          }}
        />
      </Card>
    </Frame>
  );
}

// ------------------------------------------------------------------ etapa 2
function HoursStep({ onNext }: { onNext: () => void }) {
  const { base, tenantId } = useTenant();
  const qc = useQueryClient();
  const hours = useBusinessHours();
  const [value, setValue] = useState<WeeklyIntervalDto[] | null>(null);
  useEffect(() => {
    if (hours.data && value === null) setValue(hours.data.length ? hours.data : SUGGESTED_HOURS);
  }, [hours.data, value]);
  const save = useMutation({
    mutationFn: (intervals: WeeklyIntervalDto[]) =>
      api(`${base}/business-hours`, { method: 'PUT', body: { intervals } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['business-hours', tenantId] });
      onNext();
    },
  });
  if (!value) return <BrandLoader />;
  const error = weeklyError(value);
  const empty = value.length === 0;
  return (
    <Frame step="hours">
      <StepTitle
        title="Horário de funcionamento"
        description="A recepcionista só oferece horários dentro destes períodos. Use duas faixas no mesmo dia para o intervalo de almoço."
      />
      {hours.data?.length === 0 ? (
        <Notice tone="brass" className="mb-4">
          Sugestão inicial preenchida — ajuste para o horário real do seu estabelecimento antes de continuar.
        </Notice>
      ) : null}
      <WeeklyHoursEditor value={value} onChange={setValue} className="bg-white" />
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      <div className="mt-8 flex justify-end">
        <Button
          size="lg"
          disabled={Boolean(error) || empty}
          loading={save.isPending}
          onClick={() => save.mutate(value)}
        >
          Salvar e continuar
        </Button>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ etapa 3
function ServicesStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { base, tenantId, tenant } = useTenant();
  const qc = useQueryClient();
  const services = useServices();
  const [formKey, setFormKey] = useState(0);
  const [prefill, setPrefill] = useState(emptyService());
  const suggestions = (SERVICE_SUGGESTIONS[tenant?.category ?? 'BARBERSHOP'] ?? []).filter(
    (s) => !services.data?.some((x) => x.name.toLowerCase() === s.name.toLowerCase()),
  );
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', tenantId] }),
  });

  return (
    <Frame step="services">
      <StepTitle
        title="Serviços e preços"
        description="Cadastre o que você oferece. A recepcionista nunca informa preço que não esteja aqui."
      />
      {services.data && services.data.length > 0 ? (
        <Card className="mb-6 divide-y divide-ink-100">
          {services.data.map((s: ServiceDto) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-3">
              <Scissors className="size-4 text-ink-400" />
              <span className="flex-1 text-sm font-medium text-ink-900">{s.name}</span>
              <span className="text-[13px] text-ink-500">{durationLabel(s.durationMin)}</span>
              <span className="w-32 text-right text-[13px] font-medium text-ink-800">
                {priceLabel(s.priceCents, s.priceType)}
              </span>
              <button
                className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-700"
                aria-label={`Remover ${s.name}`}
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      ) : null}

      <Card className="p-5 sm:p-7">
        <p className="text-sm font-semibold text-ink-900">Adicionar serviço</p>
        {suggestions.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  setPrefill(emptyService({ name: s.name, durationMin: s.durationMin }));
                  setFormKey((k) => k + 1);
                }}
                className="rounded-full bg-ink-50 px-3 py-1.5 text-[13px] text-ink-700 ring-1 ring-ink-150 transition-colors hover:bg-brass-50 hover:ring-brass-300"
              >
                + {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-5">
          <ServiceForm
            key={formKey}
            compact
            initial={prefill}
            submitLabel="Adicionar"
            onSubmit={async (payload) => {
              await api(`${base}/services`, { method: 'POST', body: payload });
              await qc.invalidateQueries({ queryKey: ['services', tenantId] });
              setPrefill(emptyService());
              setFormKey((k) => k + 1);
              toast.success('Serviço adicionado');
            }}
          />
        </div>
      </Card>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Voltar
        </Button>
        <Button size="lg" disabled={!services.data?.length} onClick={onNext}>
          Continuar
        </Button>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ etapa 4
function ProfessionalsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { base, tenantId } = useTenant();
  const qc = useQueryClient();
  const services = useServices();
  const professionals = useProfessionals();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[] | null>(null);
  const allIds = services.data?.map((s) => s.id) ?? [];
  const chosen = selected ?? allIds;
  const add = useMutation({
    mutationFn: () =>
      api<ProfessionalDto>(`${base}/professionals`, { method: 'POST', body: { name, serviceIds: chosen } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['professionals', tenantId] });
      setName('');
      setSelected(null);
      toast.success('Profissional adicionado');
    },
  });
  const ok = professionals.data?.some((p) => p.services.length > 0);

  return (
    <Frame step="professionals">
      <StepTitle
        title="Profissionais"
        description="Quem atende e quais serviços cada um faz. Jornadas próprias, folgas e preços diferenciados podem ser ajustados depois."
      />
      {professionals.data?.length ? (
        <Card className="mb-6 divide-y divide-ink-100">
          {professionals.data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3">
              <UserRound className="size-4 text-ink-400" />
              <span className="flex-1 text-sm font-medium text-ink-900">{p.name}</span>
              <span className="text-[13px] text-ink-500">{p.services.length} serviço(s)</span>
              <Badge tone="neutral">{p.usesBusinessHours ? 'Horário da casa' : 'Jornada própria'}</Badge>
            </div>
          ))}
        </Card>
      ) : null}
      <Card className="p-5 sm:p-7">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2 && chosen.length) add.mutate();
          }}
        >
          <Field label="Nome do profissional">
            {(p) => (
              <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João" />
            )}
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">Serviços que realiza</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {services.data?.map((s) => (
                <Checkbox
                  key={s.id}
                  label={s.name}
                  checked={chosen.includes(s.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...new Set([...chosen, s.id])] : chosen.filter((id) => id !== s.id),
                    )
                  }
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="secondary"
              loading={add.isPending}
              disabled={name.trim().length < 2 || !chosen.length}
            >
              <Plus className="size-4" /> Adicionar profissional
            </Button>
          </div>
        </form>
      </Card>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Voltar
        </Button>
        <Button size="lg" disabled={!ok} onClick={onNext}>
          Continuar
        </Button>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ etapa 5
function ReviewStep({ onBack }: { onBack: () => void }) {
  const { base, tenantId } = useTenant();
  const qc = useQueryClient();
  const router = useRouter();
  const status = useOnboarding();
  const complete = useMutation({
    mutationFn: () => api(`${base}/onboarding/complete`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['me'] }),
        qc.invalidateQueries({ queryKey: ['tenant', tenantId] }),
      ]);
      toast.success('Configuração concluída!');
      router.push('/painel');
    },
  });
  const labels: Record<string, string> = {
    business: 'Dados do estabelecimento',
    hours: 'Horário de funcionamento',
    services: 'Serviços com preço',
    professionals: 'Profissionais com serviços',
    channels: 'Telefone e WhatsApp',
    receptionist: 'Personagem, voz e linguagem',
    review: 'Revisão final',
  };
  const later: Record<string, string> = {
    channels: 'Fase 4 — requer integração',
    receptionist: 'Voice Studio — Fase 3',
  };
  return (
    <Frame step="review">
      <StepTitle
        title="Tudo pronto para começar"
        description="Confira o checklist. As etapas marcadas como próximas fases serão liberadas conforme a evolução do produto."
      />
      <Card className="divide-y divide-ink-100">
        {status.data?.steps
          .filter((s) => s.key !== 'review')
          .map((s) => (
            <div key={s.key} className="flex items-center gap-3 px-5 py-3.5">
              {s.done ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="size-3.5" />
                </span>
              ) : (
                <CircleDashed className="size-6 text-ink-300" />
              )}
              <span className="flex-1 text-sm text-ink-800">{labels[s.key]}</span>
              {!s.required && later[s.key] ? <Badge tone="neutral">{later[s.key]}</Badge> : null}
              {s.required && !s.done ? <Badge tone="warning">Pendente</Badge> : null}
            </div>
          ))}
      </Card>
      <Notice tone="info" className="mt-6">
        A recepcionista de IA continua desativada até a integração dos canais e a escolha da personagem.
        Enquanto isso, a agenda e o CRM já funcionam pelo painel.
      </Notice>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Voltar
        </Button>
        <Button
          size="lg"
          disabled={!status.data?.canComplete}
          loading={complete.isPending}
          onClick={() => complete.mutate()}
        >
          Concluir e abrir o painel
        </Button>
      </div>
    </Frame>
  );
}

function TenantWizard() {
  const { membership } = useSession();
  const status = useOnboarding();
  const [step, setStep] = useState<OnboardingStep | null>(null);
  useEffect(() => {
    if (step || !status.data) return;
    const first = status.data.steps.find((s) => s.required && !s.done)?.key ?? 'review';
    setStep(first === 'business' ? 'hours' : first);
  }, [status.data, step]);
  if (!step) return <BrandLoader label={`Preparando ${membership.tenantName}…`} />;
  const go = (s: OnboardingStep) => {
    setStep(s);
    window.scrollTo({ top: 0 });
  };
  if (step === 'hours') return <HoursStep onNext={() => go('services')} />;
  if (step === 'services')
    return <ServicesStep onNext={() => go('professionals')} onBack={() => go('hours')} />;
  if (step === 'professionals')
    return <ProfessionalsStep onNext={() => go('review')} onBack={() => go('services')} />;
  return <ReviewStep onBack={() => go('professionals')} />;
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const me = useMe();
  const [createdTenant, setCreatedTenant] = useState<string | null>(null);
  const forceNew = params.get('novo') === '1' && !createdTenant;

  useEffect(() => {
    if (me.error?.status === 401) router.replace('/entrar?next=/onboarding');
  }, [me.error, router]);

  if (me.isPending || !me.data) return <BrandLoader />;
  const memberships = me.data.memberships;
  const pending = createdTenant
    ? memberships.find((m) => m.tenantId === createdTenant)
    : memberships.find((m) => !m.onboardingCompleted);

  if (forceNew || memberships.length === 0 || (createdTenant && !pending)) {
    return (
      <BusinessStep
        onCreated={async (t) => {
          setCreatedTenant(t.id);
          await qc.invalidateQueries({ queryKey: ['me'] });
          router.replace('/onboarding');
        }}
      />
    );
  }
  if (!pending) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo />
        <p className="text-ink-600">A configuração deste estabelecimento já foi concluída.</p>
        <Button asChild>
          <Link href="/painel">Ir para o painel</Link>
        </Button>
      </div>
    );
  }
  return (
    <SessionGate tenantId={pending.tenantId}>
      <TenantWizard />
    </SessionGate>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<BrandLoader />}>
      <Onboarding />
    </Suspense>
  );
}
