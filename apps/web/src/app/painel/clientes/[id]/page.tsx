'use client';

import type { ConsentPurpose, CustomerDto } from '@barber-voice/contracts';
import { APPOINTMENT_STATUS_LABELS } from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { STATUS_TONE } from '@/components/agenda/appointment-details-dialog';
import { CreateAppointmentDialog } from '@/components/agenda/create-appointment-dialog';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ApiError, api } from '@/lib/api';
import { formatPhoneDisplay, priceLabel, shortDate, todayIn } from '@/lib/format';
import { useCustomer, useProfessionals } from '@/lib/hooks';
import { useTenant } from '@/lib/session';

const CONSENTS: { purpose: ConsentPurpose; label: string; description: string }[] = [
  {
    purpose: 'WHATSAPP_TRANSACTIONAL',
    label: 'Confirmações e lembretes no WhatsApp',
    description: 'Mensagens sobre os próprios agendamentos.',
  },
  {
    purpose: 'WHATSAPP_MARKETING',
    label: 'Promoções e campanhas no WhatsApp',
    description: 'Exige consentimento específico (LGPD e políticas da Meta).',
  },
  {
    purpose: 'CALL_RECORDING',
    label: 'Gravação de ligações',
    description: 'Somente se o estabelecimento gravar chamadas.',
  },
];

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { base, tenantId, tz, canManage } = useTenant();
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isPending, error } = useCustomer(id);
  const professionals = useProfessionals();
  const [form, setForm] = useState<Partial<CustomerDto> & { style?: string; other?: string }>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [book, setBook] = useState(false);
  const [anonymize, setAnonymize] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [channel, setChannel] = useState<'IN_PERSON' | 'PHONE' | 'WHATSAPP' | 'FORM' | 'OTHER'>('IN_PERSON');

  useEffect(() => {
    if (data) {
      setForm({
        ...data.customer,
        phone: data.customer.phone ? formatPhoneDisplay(data.customer.phone) : '',
        style: data.customer.preferences.style ?? '',
        other: data.customer.preferences.other ?? '',
      });
    }
  }, [data]);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['customer', tenantId, id] }),
      qc.invalidateQueries({ queryKey: ['customers', tenantId] }),
    ]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api(`${base}/customers/${id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          phone: form.phone ?? '',
          email: form.email ?? '',
          birthDate: form.birthDate || null,
          notes: form.notes ?? '',
          preferences: { style: form.style ?? '', other: form.other ?? '' },
          preferredProfessionalId: form.preferredProfessionalId || null,
        },
      }),
    onSuccess: async () => {
      await invalidate();
      setErrors({});
      toast.success('Cadastro atualizado');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        toast.error(err.message);
      }
    },
  });

  const consent = useMutation({
    mutationFn: (v: { purpose: ConsentPurpose; granted: boolean }) =>
      api(`${base}/customers/${id}/consents`, { method: 'POST', body: { ...v, channel } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Consentimento registrado');
    },
  });

  const anon = useMutation({
    mutationFn: () => api(`${base}/customers/${id}/anonymize`, { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['customers', tenantId] });
      toast.success('Dados pessoais removidos');
      router.replace('/painel/clientes');
    },
  });

  if (isPending) return <Skeleton className="h-96 rounded-2xl" />;
  if (error || !data) {
    return (
      <Card>
        <EmptyState
          title="Cliente não encontrado"
          action={
            <Button asChild variant="secondary">
              <Link href="/painel/clientes">Voltar</Link>
            </Button>
          }
        />
      </Card>
    );
  }
  const c = data.customer;
  const consentState = (p: ConsentPurpose) => data.consents.find((x) => x.purpose === p);

  return (
    <>
      <Link
        href="/painel/clientes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" /> Clientes
      </Link>
      <PageHeader
        title={c.name}
        description={[
          c.phone ? formatPhoneDisplay(c.phone) : null,
          `${c.visitsCount} visita(s)`,
          c.noShowCount ? `${c.noShowCount} falta(s)` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Button onClick={() => setBook(true)}>
            <CalendarPlus className="size-4" /> Agendar
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Histórico de atendimentos" description="Últimos 30 registros" />
            <CardBody className="px-0 sm:px-0">
              {data.appointments.length === 0 ? (
                <p className="px-6 pb-2 text-sm text-ink-400">Nenhum atendimento ainda.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {data.appointments.map((a) => (
                    <li key={a.id} className="flex items-center gap-4 px-5 py-3 sm:px-6">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink-900">{shortDate(a.startsAt, tz)}</span>
                        <span className="block truncate text-[13px] text-ink-500">
                          {a.items.map((i) => i.serviceName).join(' + ')} · {a.professional.name}
                        </span>
                      </span>
                      <span className="hidden text-[13px] text-ink-600 sm:block">
                        {a.totalPriceCents !== null
                          ? priceLabel(a.totalPriceCents, a.priceIsEstimate ? 'STARTING_AT' : 'FIXED')
                          : 'sob consulta'}
                      </span>
                      <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>
                        {APPOINTMENT_STATUS_LABELS[a.status]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Consentimentos (LGPD)"
              description="Cada alteração fica registrada com data e canal."
            />
            <CardBody className="flex flex-col gap-4">
              <Field label="Como o cliente informou?">
                {(p) => (
                  <Select
                    {...p}
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as typeof channel)}
                  >
                    <option value="IN_PERSON">Pessoalmente</option>
                    <option value="PHONE">Por telefone</option>
                    <option value="WHATSAPP">Pelo WhatsApp</option>
                    <option value="FORM">Por formulário</option>
                    <option value="OTHER">Outro</option>
                  </Select>
                )}
              </Field>
              {CONSENTS.map((item) => {
                const st = consentState(item.purpose);
                return (
                  <Switch
                    key={item.purpose}
                    checked={Boolean(st?.granted)}
                    disabled={consent.isPending}
                    onCheckedChange={(granted) => consent.mutate({ purpose: item.purpose, granted })}
                    label={item.label}
                    description={
                      st
                        ? `${item.description} Registrado em ${shortDate(st.recordedAt, tz)}.`
                        : `${item.description} Sem registro.`
                    }
                  />
                );
              })}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Cadastro" />
            <CardBody>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <Field label="Nome" error={errors.name}>
                  {(p) => (
                    <Input
                      {...p}
                      value={form.name ?? ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Telefone" optional error={errors.phone}>
                    {(p) => (
                      <Input
                        {...p}
                        type="tel"
                        inputMode="tel"
                        value={form.phone ?? ''}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Aniversário" optional error={errors.birthDate}>
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        value={form.birthDate ?? ''}
                        onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <Field label="E-mail" optional error={errors.email}>
                  {(p) => (
                    <Input
                      {...p}
                      type="email"
                      value={form.email ?? ''}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Profissional preferido" optional>
                  {(p) => (
                    <Select
                      {...p}
                      value={form.preferredProfessionalId ?? ''}
                      onChange={(e) => setForm({ ...form, preferredProfessionalId: e.target.value || null })}
                    >
                      <option value="">Sem preferência</option>
                      {(professionals.data ?? []).map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label="Preferências de estilo"
                  optional
                  hint="Informações que o cliente autorizou registrar."
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={form.style ?? ''}
                      onChange={(e) => setForm({ ...form, style: e.target.value })}
                      placeholder="Ex.: degradê baixo, tesoura em cima"
                    />
                  )}
                </Field>
                <Field
                  label="Observações internas"
                  optional
                  hint="Não são lidas para o cliente pela recepcionista."
                >
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={3}
                      value={form.notes ?? ''}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  )}
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" loading={save.isPending}>
                    Salvar
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {canManage ? (
            <Card className="ring-1 ring-rose-100">
              <CardHeader title="Privacidade" description="Atendimento a pedido de exclusão (LGPD)." />
              <CardBody>
                <Button variant="danger-ghost" onClick={() => setAnonymize(true)}>
                  <ShieldAlert className="size-4" /> Anonimizar dados do cliente
                </Button>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <CreateAppointmentDialog
        open={book}
        onOpenChange={setBook}
        prefill={{ date: todayIn(tz), customer: { id: c.id, name: c.name } }}
      />
      <Dialog
        open={anonymize}
        onOpenChange={setAnonymize}
        title="Anonimizar cliente"
        description="Remove nome, telefone, e-mail, aniversário, preferências e observações. Métricas agregadas são preservadas. Esta ação não pode ser desfeita."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAnonymize(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={confirmText.trim().toUpperCase() !== 'ANONIMIZAR'}
              loading={anon.isPending}
              onClick={() => anon.mutate()}
            >
              Anonimizar definitivamente
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          <Notice tone="warning">Agendamentos futuros precisam ser cancelados antes.</Notice>
          <Field label='Digite "ANONIMIZAR" para confirmar'>
            {(p) => <Input {...p} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
