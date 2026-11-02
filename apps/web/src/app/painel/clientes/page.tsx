'use client';

import type { CustomerDto } from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Notice, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { ApiError, api } from '@/lib/api';
import { formatPhoneDisplay, initials, shortDate } from '@/lib/format';
import { useCustomers } from '@/lib/hooks';
import { useTenant } from '@/lib/session';

function NewCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { base, tenantId } = useTenant();
  const qc = useQueryClient();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<string | null>(null);
  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => api<CustomerDto>(`${base}/customers`, { method: 'POST', body: form }),
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['customers', tenantId] });
      toast.success('Cliente cadastrado');
      onOpenChange(false);
      setForm({ name: '', phone: '', email: '' });
      router.push(`/painel/clientes/${c.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        if (err.code === 'CUSTOMER_PHONE_EXISTS')
          setExisting((err.details as { customerId?: string })?.customerId ?? null);
        else toast.error(err.message);
      }
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Novo cliente"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            Cadastrar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {existing ? (
          <Notice tone="warning" title="Telefone já cadastrado">
            <Link href={`/painel/clientes/${existing}`} className="font-medium underline">
              Abrir o cadastro existente
            </Link>
          </Notice>
        ) : null}
        <Field label="Nome" error={errors.name}>
          {(p) => (
            <Input
              {...p}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          )}
        </Field>
        <Field label="Telefone" optional error={errors.phone}>
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          )}
        </Field>
        <Field label="E-mail" optional error={errors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export default function CustomersPage() {
  const { tz } = useTenant();
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const { data, isPending } = useCustomers(deferred.trim(), offset);

  return (
    <>
      <PageHeader
        title="Clientes"
        description={data ? `${data.total} cliente(s)` : ' '}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Novo cliente
          </Button>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400" />
        <Input
          className="pl-10"
          placeholder="Buscar por nome ou telefone"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      {isPending ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : !data?.customers.length ? (
        <Card>
          <EmptyState
            icon={<Users className="size-5" />}
            title={q ? 'Nenhum cliente encontrado' : 'Seus clientes aparecem aqui'}
            description={
              q ? 'Tente outro nome ou parte do telefone.' : 'Clientes são criados ao agendar ou manualmente.'
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {data.customers.map((c) => (
            <Link
              key={c.id}
              href={`/painel/clientes/${c.id}`}
              className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-ink-50/70 sm:px-6"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[13px] font-semibold text-ink-600">
                {initials(c.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">{c.name}</span>
                <span className="block truncate text-[13px] text-ink-500">
                  {c.phone ? formatPhoneDisplay(c.phone) : 'Sem telefone'}
                  {c.lastVisitAt ? ` · última visita ${shortDate(c.lastVisitAt, tz).split(' ')[0]}` : ''}
                </span>
              </span>
              <span className="hidden gap-2 sm:flex">
                {c.visitsCount > 0 ? (
                  <Badge tone="success">{c.visitsCount} visita(s)</Badge>
                ) : (
                  <Badge>Novo</Badge>
                )}
                {c.noShowCount > 0 ? <Badge tone="danger">{c.noShowCount} falta(s)</Badge> : null}
                {c.tags.slice(0, 2).map((t) => (
                  <Badge key={t} tone="brass">
                    {t}
                  </Badge>
                ))}
              </span>
              <ChevronRight className="size-4 text-ink-300" />
            </Link>
          ))}
        </Card>
      )}
      {data && data.total > 30 ? (
        <div className="mt-4 flex justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 30))}
          >
            Anteriores
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset + 30 >= data.total}
            onClick={() => setOffset(offset + 30)}
          >
            Próximos
          </Button>
        </div>
      ) : null}
      <NewCustomerDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
