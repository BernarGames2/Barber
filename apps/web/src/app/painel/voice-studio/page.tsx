'use client';

import type {
  InstructionsPreviewDto,
  PersonaSummaryDto,
  ReceptionistConfigInput,
  VoiceStudioDto,
} from '@barber-voice/contracts';
import {
  type Formality,
  type LanguageSettings,
  type Scale,
  type SlangLevel,
  renderExample,
  resolveEffectiveLanguage,
  toSpeechText,
} from '@barber-voice/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  FileText,
  Lock,
  MessageCircle,
  Mic2,
  PhoneCall,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Notice, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useTenant } from '@/lib/session';

type Draft = Omit<ReceptionistConfigInput, 'personaId'> & { personaId: string | null };

const FORMALITY_OPTIONS: { value: Formality; label: string; hint: string }[] = [
  { value: 'FORMAL', label: 'Formal', hint: 'Profissional e cortês, sem gírias' },
  { value: 'SEMIFORMAL', label: 'Semiformal', hint: 'Cordial e próxima' },
  { value: 'INFORMAL', label: 'Informal', hint: 'Descontraída e natural' },
];
const SLANG_OPTIONS: { value: SlangLevel; label: string }[] = [
  { value: 'NONE', label: 'Nenhuma' },
  { value: 'LOW', label: 'Baixa' },
  { value: 'MODERATE', label: 'Moderada' },
  { value: 'HIGH', label: 'Alta' },
];

function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
  disabled?: boolean;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-ink-50 p-1 ring-1 ring-ink-100"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 rounded-lg px-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed',
            value === o.value ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const listToText = (l: string[]) => l.join(', ');
const textToList = (t: string) =>
  t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function PersonaCard({
  persona,
  selected,
  formality,
  businessName,
  onSelect,
  disabled,
}: {
  persona: PersonaSummaryDto;
  selected: boolean;
  formality: Formality;
  businessName: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'relative flex h-full flex-col rounded-2xl bg-white p-5 text-left shadow-card transition-all disabled:cursor-default',
        selected ? 'ring-2 ring-brass-500' : 'hover:shadow-pop',
      )}
    >
      {selected ? (
        <span className="absolute top-4 right-4 flex size-6 items-center justify-center rounded-full bg-brass-500 text-ink-950">
          <Check className="size-3.5" />
        </span>
      ) : null}
      <div className="flex items-center gap-2 pr-8">
        <p className="font-display text-2xl leading-none text-ink-900">{persona.name}</p>
        {persona.isCustom ? <Badge tone="brass">Sua</Badge> : null}
      </div>
      <p className="mt-2 text-[13px] text-ink-600">{persona.tagline}</p>
      <p className="mt-4 rounded-xl bg-ink-50 px-3 py-2.5 text-[13px] leading-relaxed text-ink-700 italic">
        “{renderExample(persona.examples[formality].greeting, { estabelecimento: businessName })}”
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {persona.suggestedVoiceTags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] text-ink-500 ring-1 ring-ink-100"
          >
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

function PreviewPanel({
  draft,
  persona,
  businessName,
}: {
  draft: Draft;
  persona: PersonaSummaryDto | undefined;
  businessName: string;
}) {
  const { base } = useTenant();
  const [channel, setChannel] = useState<'WHATSAPP' | 'PHONE'>('WHATSAPP');
  const [open, setOpen] = useState<string | null>(null);
  const preview = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api<InstructionsPreviewDto>(`${base}/voice-studio/preview`, {
        method: 'POST',
        body: { ...draft, channel },
      }),
  });
  // a prévia compilada fica desatualizada a cada mudança do rascunho ou do canal
  const { reset } = preview;
  useEffect(() => reset(), [channel, draft, reset]);

  if (!persona) return null;
  const ex = persona.examples[draft.formality];
  const lines = [ex.greeting, ex.offer, ex.confirm, ex.farewell].map((l) =>
    renderExample(l, { estabelecimento: businessName }),
  );
  return (
    <Card>
      <CardHeader
        title="Prévia de tom"
        description="Exemplos escritos para a personagem nesta formalidade — não são respostas geradas por IA."
        action={
          <Segmented
            label="Canal da prévia"
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'WHATSAPP', label: 'WhatsApp' },
              { value: 'PHONE', label: 'Telefone' },
            ]}
          />
        }
      />
      <CardBody className="flex flex-col gap-4">
        {channel === 'WHATSAPP' ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-[#efeae2] p-4">
            {lines.map((l, i) => (
              <p
                key={i}
                className="max-w-[85%] self-end rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[14px] leading-snug text-ink-900 shadow-sm"
              >
                {l}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl bg-ink-900 p-4 text-paper">
            <p className="flex items-center gap-2 text-xs text-ink-400">
              <PhoneCall className="size-3.5" /> Texto exatamente como seria enviado à síntese de voz
            </p>
            {lines.map((l, i) => (
              <p key={i} className="text-[14px] leading-relaxed text-ink-100">
                {toSpeechText(l)}
              </p>
            ))}
          </div>
        )}
        <div>
          <Button
            variant="secondary"
            size="sm"
            loading={preview.isPending}
            onClick={() => preview.mutate()}
            disabled={!draft.personaId}
          >
            <FileText className="size-4" /> Ver instruções que a recepcionista receberia
          </Button>
          {preview.error ? (
            <p className="mt-2 text-sm text-rose-700">{(preview.error as Error).message}</p>
          ) : null}
          {preview.data ? (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-ink-400">
                Compiladas a partir dos seus dados cadastrados · versão {preview.data.hash}
              </p>
              {preview.data.sections.map((s) => (
                <div key={s.key} className="rounded-xl ring-1 ring-ink-100">
                  <button
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] font-medium text-ink-800"
                    onClick={() => setOpen(open === s.key ? null : s.key)}
                  >
                    {s.title}
                    <ChevronDown
                      className={cn(
                        'size-4 text-ink-400 transition-transform',
                        open === s.key && 'rotate-180',
                      )}
                    />
                  </button>
                  {open === s.key ? (
                    <pre className="max-h-80 overflow-auto border-t border-ink-100 bg-ink-50/60 px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-700">
                      {s.content}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function CustomPersonaDialog({
  open,
  onOpenChange,
  personas,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  personas: PersonaSummaryDto[];
}) {
  const { base, tenantId } = useTenant();
  const qc = useQueryClient();
  const library = personas.filter((p) => !p.isCustom);
  const [form, setForm] = useState({
    basePersonaId: library[0]?.id ?? '',
    name: '',
    tagline: '',
    personality: '',
    speakingStyle: '',
    phrases: '',
    presentation: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api(`${base}/voice-studio/personas`, {
        method: 'POST',
        body: { ...form, signaturePhrases: textToList(form.phrases) },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['voice-studio', tenantId] });
      toast.success('Personagem criada');
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        toast.error(err.message);
      }
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Criar personagem própria"
      description="Parte de uma personagem da biblioteca e ganha a identidade do seu estabelecimento."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            Criar personagem
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Baseada em">
            {(p) => (
              <Select
                {...p}
                value={form.basePersonaId}
                onChange={(e) => setForm({ ...form, basePersonaId: e.target.value })}
              >
                {library.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Nome" error={errors.name}>
            {(p) => (
              <Input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            )}
          </Field>
        </div>
        <Field label="Descrição curta" error={errors.tagline}>
          {(p) => (
            <Input
              {...p}
              value={form.tagline}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            />
          )}
        </Field>
        <Field label="Personalidade" error={errors.personality}>
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={form.personality}
              onChange={(e) => setForm({ ...form, personality: e.target.value })}
            />
          )}
        </Field>
        <Field label="Jeito de falar" error={errors.speakingStyle}>
          {(p) => (
            <Input
              {...p}
              value={form.speakingStyle}
              onChange={(e) => setForm({ ...form, speakingStyle: e.target.value })}
            />
          )}
        </Field>
        <Field label="Frases características" optional hint="Separadas por vírgula.">
          {(p) => (
            <Input
              {...p}
              value={form.phrases}
              onChange={(e) => setForm({ ...form, phrases: e.target.value })}
            />
          )}
        </Field>
        <Field label="Mensagem de apresentação" error={errors.presentation}>
          {(p) => (
            <Input
              {...p}
              value={form.presentation}
              onChange={(e) => setForm({ ...form, presentation: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export default function VoiceStudioPage() {
  const { base, tenantId, tenant, canManage } = useTenant();
  const qc = useQueryClient();
  const vs = useQuery<VoiceStudioDto, ApiError>({
    queryKey: ['voice-studio', tenantId],
    queryFn: () => api<VoiceStudioDto>(`${base}/voice-studio`),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [segment, setSegment] = useState<'BARBERSHOP' | 'SALON' | 'CUSTOM'>('BARBERSHOP');
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (!vs.data || draft) return;
    const c = vs.data.config;
    const salon = tenant && tenant.category !== 'BARBERSHOP';
    setSegment(salon ? 'SALON' : 'BARBERSHOP');
    setDraft(
      c
        ? { ...c, receptionistName: c.receptionistName ?? null }
        : {
            personaId: null,
            receptionistName: null,
            formality: 'SEMIFORMAL',
            slangLevel: 'LOW',
            emojisEnabled: false,
            enthusiasm: 3,
            relaxation: 3,
            useCustomerName: 'GREETING',
            greeting: null,
            farewell: null,
            signatureExpressions: [],
            vocabularyPrefer: [],
            vocabularyAvoid: [],
            businessInstructions: null,
          },
    );
  }, [vs.data, draft, tenant]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (d: Draft) => api<VoiceStudioDto>(`${base}/voice-studio/config`, { method: 'PUT', body: d }),
    onSuccess: (data) => {
      qc.setQueryData(['voice-studio', tenantId], data);
      toast.success('Recepcionista salva');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Não foi possível salvar'),
  });

  const persona = vs.data?.personas.find((p) => p.id === draft?.personaId);
  const effective = useMemo(() => {
    if (!draft) return null;
    const settings: LanguageSettings = {
      ...draft,
      enthusiasm: draft.enthusiasm as Scale,
      relaxation: draft.relaxation as Scale,
      receptionistName: draft.receptionistName ?? null,
      greeting: draft.greeting ?? null,
      farewell: draft.farewell ?? null,
    };
    return {
      phone: resolveEffectiveLanguage(settings, 'PHONE'),
      whatsapp: resolveEffectiveLanguage(settings, 'WHATSAPP'),
    };
  }, [draft]);

  if (vs.isPending || !draft) return <Skeleton className="h-[600px] rounded-2xl" />;
  if (vs.error) return <Notice tone="danger">{vs.error.message}</Notice>;
  const data = vs.data;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const advanced = data.features.advancedLanguage;
  const editable = canManage;
  const businessName = tenant?.name ?? 'seu estabelecimento';
  const visible = data.personas.filter((p) =>
    segment === 'CUSTOM' ? p.isCustom : !p.isCustom && (p.segment === segment || p.segment === 'ANY'),
  );
  const adjustments = [
    ...new Map(
      [...(effective?.whatsapp.adjustments ?? []), ...(effective?.phone.adjustments ?? [])].map((a) => [
        a.reason,
        a,
      ]),
    ).values(),
  ];
  const DRAFT_KEYS = Object.keys(draft) as (keyof Draft)[];
  const project = (o: Partial<Record<keyof Draft, unknown>> | null) =>
    o ? JSON.stringify(DRAFT_KEYS.map((k) => o[k] ?? null)) : null;
  const dirty = project(draft) !== project(data.config);

  return (
    <>
      <PageHeader
        title="Voice Studio"
        description="Quem a recepcionista é e como ela fala — escolhas independentes."
        actions={
          editable ? (
            <Button disabled={!draft.personaId} loading={save.isPending} onClick={() => save.mutate(draft)}>
              {data.config ? 'Salvar alterações' : 'Salvar recepcionista'}
            </Button>
          ) : null
        }
      />
      <Notice tone="info" className="mb-6">
        A recepcionista permanece desativada até a integração de telefone/WhatsApp e do modelo de IA (Fase 4).
        Aqui você já define a identidade que ela vai usar — e pode conferir exatamente as instruções que
        receberá.
      </Notice>

      {/* ------------------------------------------------ personagem */}
      <section className="mb-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[15px] font-semibold text-ink-900">1. Personagem</h2>
          <div className="flex items-center gap-2">
            <div className="w-72">
              <Segmented
                label="Filtrar personagens"
                value={segment}
                onChange={setSegment}
                options={[
                  { value: 'BARBERSHOP', label: 'Barbearias' },
                  { value: 'SALON', label: 'Salões' },
                  { value: 'CUSTOM', label: 'Suas' },
                ]}
              />
            </div>
            {editable ? (
              data.features.customPersonas ? (
                <Button variant="secondary" size="sm" onClick={() => setCustomOpen(true)}>
                  <Plus className="size-4" /> Criar
                </Button>
              ) : (
                <Badge tone="neutral">
                  <Lock className="size-3" /> Própria: plano Pro
                </Badge>
              )
            ) : null}
          </div>
        </div>
        {visible.length === 0 ? (
          <Card className="p-6 text-sm text-ink-500">Nenhuma personagem própria ainda.</Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => (
              <PersonaCard
                key={p.id}
                persona={p}
                selected={p.id === draft.personaId}
                formality={draft.formality}
                businessName={businessName}
                disabled={!editable}
                onSelect={() =>
                  setDraft((d) =>
                    d
                      ? d.personaId
                        ? { ...d, personaId: p.id } // troca de personagem NÃO altera a linguagem escolhida
                        : { ...d, personaId: p.id, ...p.defaults }
                      : d,
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* ------------------------------------------------ linguagem */}
        <Card>
          <CardHeader
            title="2. Linguagem"
            description="Independente da personagem: a Rocker pode falar formalmente, a Sofia pode ser descontraída."
            action={
              persona && editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft((d) => (d ? { ...d, ...persona.defaults } : d))}
                >
                  <Sparkles className="size-3.5" /> Sugestão da {persona.name}
                </Button>
              ) : null
            }
          />
          <CardBody className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-700">Formalidade</p>
              <Segmented
                label="Formalidade"
                value={draft.formality}
                onChange={(v) => set('formality', v)}
                options={FORMALITY_OPTIONS}
                disabled={!editable}
              />
              <p className="mt-1.5 text-xs text-ink-400">
                {FORMALITY_OPTIONS.find((f) => f.value === draft.formality)?.hint}
              </p>
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-700">Gírias</p>
              <Segmented
                label="Intensidade das gírias"
                value={draft.slangLevel}
                onChange={(v) => set('slangLevel', v)}
                options={SLANG_OPTIONS}
                disabled={!editable}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-700">Entusiasmo</p>
                <Segmented
                  label="Entusiasmo"
                  value={draft.enthusiasm}
                  onChange={(v) => set('enthusiasm', v)}
                  options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
                  disabled={!editable}
                />
              </div>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-700">Descontração</p>
                <Segmented
                  label="Descontração"
                  value={draft.relaxation}
                  onChange={(v) => set('relaxation', v)}
                  options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
                  disabled={!editable}
                />
              </div>
            </div>
            <Switch
              checked={draft.emojisEnabled}
              onCheckedChange={(v) => set('emojisEnabled', v)}
              disabled={!editable}
              label="Emojis no WhatsApp"
              description="No telefone, emojis nunca são usados."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Nome da recepcionista"
                optional
                hint={
                  persona?.defaultReceptionistName
                    ? `Padrão: ${persona.defaultReceptionistName}`
                    : 'Sem nome: "assistente virtual"'
                }
              >
                {(p) => (
                  <Input
                    {...p}
                    disabled={!editable}
                    value={draft.receptionistName ?? ''}
                    onChange={(e) => set('receptionistName', e.target.value || null)}
                  />
                )}
              </Field>
              <Field label="Uso do nome do cliente">
                {(p) => (
                  <Select
                    {...p}
                    disabled={!editable}
                    value={draft.useCustomerName}
                    onChange={(e) => set('useCustomerName', e.target.value as Draft['useCustomerName'])}
                  >
                    <option value="NEVER">Nunca</option>
                    <option value="GREETING">Só na saudação e confirmação</option>
                    <option value="NATURAL">Com naturalidade</option>
                  </Select>
                )}
              </Field>
            </div>

            {adjustments.length ? (
              <Notice tone="brass" title="Ajustes automáticos para manter a coerência">
                <ul className="mt-1 list-disc pl-5">
                  {adjustments.map((a) => (
                    <li key={a.reason}>{a.reason}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}

            <div
              className={cn(
                'flex flex-col gap-4 rounded-2xl p-4 ring-1',
                advanced ? 'ring-ink-100' : 'bg-ink-50/60 ring-ink-100',
              )}
            >
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
                Personalização avançada{' '}
                {!advanced ? (
                  <Badge tone="neutral">
                    <Lock className="size-3" /> plano Pro
                  </Badge>
                ) : null}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Saudação preferida" optional>
                  {(p) => (
                    <Input
                      {...p}
                      disabled={!advanced || !editable}
                      value={draft.greeting ?? ''}
                      onChange={(e) => set('greeting', e.target.value || null)}
                    />
                  )}
                </Field>
                <Field label="Despedida preferida" optional>
                  {(p) => (
                    <Input
                      {...p}
                      disabled={!advanced || !editable}
                      value={draft.farewell ?? ''}
                      onChange={(e) => set('farewell', e.target.value || null)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Expressões do estabelecimento" optional hint="Separadas por vírgula.">
                {(p) => (
                  <Input
                    {...p}
                    disabled={!advanced || !editable}
                    value={listToText(draft.signatureExpressions)}
                    onChange={(e) => set('signatureExpressions', textToList(e.target.value))}
                  />
                )}
              </Field>
              <Field label="Termos que nunca devem ser usados" optional hint="Separados por vírgula.">
                {(p) => (
                  <Input
                    {...p}
                    disabled={!advanced || !editable}
                    value={listToText(draft.vocabularyAvoid)}
                    onChange={(e) => set('vocabularyAvoid', textToList(e.target.value))}
                  />
                )}
              </Field>
              <Field
                label="Orientações do estabelecimento"
                optional
                hint="Menor prioridade: nunca sobrepõem as regras de veracidade."
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={3}
                    disabled={!advanced || !editable}
                    value={draft.businessInstructions ?? ''}
                    onChange={(e) => set('businessInstructions', e.target.value || null)}
                  />
                )}
              </Field>
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <PreviewPanel draft={draft} persona={persona} businessName={businessName} />
          <Card>
            <CardHeader title="3. Voz" />
            <CardBody className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
                <Mic2 className="size-5" />
              </span>
              <div className="text-sm text-ink-600">
                <p className="font-medium text-ink-800">Provedor de voz ainda não configurado</p>
                <p className="mt-1 text-[13px] text-ink-500">
                  A escolha e o teste de vozes exigem um provedor de síntese de voz (ver Integrações). Nenhuma
                  voz é simulada.
                  {persona
                    ? ` Características sugeridas para ${persona.name}: ${persona.suggestedVoiceTags.join(', ')}.`
                    : ''}
                </p>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="4. Simulador" />
            <CardBody className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
                <MessageCircle className="size-5" />
              </span>
              <p className="text-[13px] text-ink-500">
                Conversar com a personagem antes de ativar ficará disponível quando o modelo de IA for
                configurado (Fase 4) — usando a agenda real em modo simulação, sem gravar reservas.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      {editable && dirty ? (
        <div className="sticky bottom-20 z-20 mt-6 flex justify-end lg:bottom-6">
          <Button
            size="lg"
            className="shadow-pop"
            disabled={!draft.personaId}
            loading={save.isPending}
            onClick={() => save.mutate(draft)}
          >
            Salvar recepcionista
          </Button>
        </div>
      ) : null}

      {customOpen ? (
        <CustomPersonaDialog open={customOpen} onOpenChange={setCustomOpen} personas={data.personas} />
      ) : null}
    </>
  );
}
