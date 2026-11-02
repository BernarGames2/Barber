'use client';

import type { ServiceDto } from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ServiceForm, emptyService, serviceToForm } from '@/components/catalog/service-form';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { durationLabel, priceLabel } from '@/lib/format';
import { useServices } from '@/lib/hooks';
import { useTenant } from '@/lib/session';

export default function ServicesPage() {
  const { base, tenantId, canManage } = useTenant();
  const qc = useQueryClient();
  const { data, isPending } = useServices();
  const [editing, setEditing] = useState<ServiceDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<ServiceDto | null>(null);
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['services', tenantId] }),
      qc.invalidateQueries({ queryKey: ['professionals', tenantId] }),
    ]);

  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/services/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await invalidate();
      setRemoving(null);
      toast.success('Serviço removido do catálogo');
    },
  });

  return (
    <>
      <PageHeader
        title="Serviços"
        description="Preços e durações que a recepcionista usa — e somente estes."
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Novo serviço
            </Button>
          ) : null
        }
      />
      {isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<Scissors className="size-5" />}
            title="Nenhum serviço cadastrado"
            description="Cadastre seus serviços com preço e duração."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {data.map((s) => (
            <div key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                  {s.name}
                  {!s.active ? <Badge>Inativo</Badge> : null}
                  {!s.bookableByAi ? (
                    <Badge tone="warning">
                      <Bot className="size-3" /> Só com a equipe
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  {durationLabel(s.durationMin)}
                  {s.bufferAfterMin ? ` + ${s.bufferAfterMin} min de intervalo` : ''}
                  {s.category ? ` · ${s.category}` : ''}
                </p>
              </div>
              <p className="text-sm font-semibold text-ink-900 sm:w-40 sm:text-right">
                {priceLabel(s.priceCents, s.priceType)}
              </p>
              {canManage ? (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(s)}
                    aria-label={`Editar ${s.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRemoving(s)}
                    aria-label={`Remover ${s.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </Card>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Novo serviço' : 'Editar serviço'}
      >
        {editing ? (
          <div className="pb-3">
            <ServiceForm
              initial={editing === 'new' ? emptyService() : serviceToForm(editing)}
              onCancel={() => setEditing(null)}
              onSubmit={async (payload) => {
                if (editing === 'new') await api(`${base}/services`, { method: 'POST', body: payload });
                else await api(`${base}/services/${editing.id}`, { method: 'PATCH', body: payload });
                await invalidate();
                toast.success('Serviço salvo');
                setEditing(null);
              }}
            />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remover serviço?"
        description="O serviço sai do catálogo e da recepcionista. Agendamentos já feitos continuam no histórico."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => removing && remove.mutate(removing.id)}
            >
              Remover
            </Button>
          </>
        }
      >
        <p className="pb-2 text-sm font-medium text-ink-900">{removing?.name}</p>
      </Dialog>
    </>
  );
}
