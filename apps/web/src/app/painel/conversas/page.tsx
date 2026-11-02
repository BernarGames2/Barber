'use client';

import type { ConversationDetailDto, ConversationSummaryDto } from '@barber-voice/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Headset, MessageCircle, MessagesSquare, PhoneCall, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConversationThread } from '@/components/receptionist/conversation-thread';
import { PageHeader } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, EmptyState, Notice, Skeleton } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatPhoneDisplay } from '@barber-voice/core';
import {
  type ConversationFilter,
  useConversation,
  useConversations,
  useReceptionistStatus,
} from '@/lib/hooks';
import { dateIn, timeIn, todayIn } from '@/lib/format';
import { useTenant } from '@/lib/session';

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: 'active', label: 'Com a recepcionista' },
  { value: 'handoff', label: 'Com a equipe' },
  { value: 'closed', label: 'Encerradas' },
  { value: 'simulations', label: 'Simulações' },
];

const STATUS_BADGE = {
  OPEN: { tone: 'success', label: 'Recepcionista' },
  HANDOFF: { tone: 'warning', label: 'Equipe' },
  CLOSED: { tone: 'neutral', label: 'Encerrada' },
} as const;

function contactLabel(c: ConversationSummaryDto) {
  if (c.customer) return c.customer.name;
  if (c.contactName) return c.contactName;
  if (c.contactPhone) return formatPhoneDisplay(c.contactPhone);
  return c.isSimulation ? 'Simulação' : 'Contato sem identificação';
}

function ConversationRow({
  c,
  active,
  onSelect,
  tz,
}: {
  c: ConversationSummaryDto;
  active: boolean;
  onSelect: () => void;
  tz: string;
}) {
  const Icon = c.channel === 'PHONE' ? PhoneCall : MessageCircle;
  const today = todayIn(tz);
  const when =
    dateIn(c.lastMessageAt, tz) === today
      ? timeIn(c.lastMessageAt, tz)
      : dateIn(c.lastMessageAt, tz).split('-').reverse().slice(0, 2).join('/');
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition',
        active ? 'bg-ink-100' : 'hover:bg-ink-50',
      )}
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-600">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink-900">{contactLabel(c)}</span>
          <span className="shrink-0 text-[11px] text-ink-400">{when}</span>
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-ink-500">
          {c.lastMessage ? c.lastMessage.content : 'Sem mensagens'}
        </span>
        {c.status === 'HANDOFF' && c.handoffReason ? (
          <span className="mt-1 block truncate text-[11px] text-amber-700">{c.handoffReason}</span>
        ) : null}
      </span>
    </button>
  );
}

function ConversationDetail({
  id,
  onBack,
  llmConfigured,
}: {
  id: string;
  onBack: () => void;
  llmConfigured: boolean;
}) {
  const { base, tenantId, tz } = useTenant();
  const qc = useQueryClient();
  const { data, isPending } = useConversation(id);
  const action = useMutation({
    mutationFn: (path: 'take-over' | 'return-to-ai' | 'close') =>
      api<ConversationDetailDto>(`${base}/conversations/${id}/${path}`, { method: 'POST' }),
    onSuccess: (c) => {
      qc.setQueryData(['conversation', tenantId, id], c);
      qc.invalidateQueries({ queryKey: ['conversations', tenantId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending || !data) {
    return (
      <Card className="p-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-4 h-40 w-full" />
      </Card>
    );
  }
  const badge = STATUS_BADGE[data.status];
  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Voltar" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink-900">{contactLabel(data)}</p>
          <p className="text-[12px] text-ink-500">
            {data.channel === 'PHONE' ? 'Ligação' : 'WhatsApp'}
            {data.contactPhone ? ` · ${formatPhoneDisplay(data.contactPhone)}` : ''}
            {data.isSimulation ? ' · simulação' : ''}
          </p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      {data.status !== 'CLOSED' && !data.isSimulation ? (
        <div className="flex flex-wrap gap-2 border-b border-ink-100 px-4 py-2.5">
          {data.status === 'OPEN' ? (
            <Button
              size="sm"
              variant="secondary"
              loading={action.isPending}
              onClick={() => action.mutate('take-over')}
            >
              <Headset className="size-3.5" /> Assumir atendimento
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={!llmConfigured}
              title={llmConfigured ? undefined : 'Recepcionista de IA não integrada'}
              loading={action.isPending}
              onClick={() => action.mutate('return-to-ai')}
            >
              <Bot className="size-3.5" /> Devolver para a recepcionista
            </Button>
          )}
          <Button size="sm" variant="ghost" loading={action.isPending} onClick={() => action.mutate('close')}>
            <XCircle className="size-3.5" /> Encerrar
          </Button>
        </div>
      ) : null}
      {data.status === 'HANDOFF' && data.handoffReason ? (
        <Notice tone="warning" className="mx-4 mt-3">
          {data.handoffReason}. Responder pelo painel chega junto com a integração dos canais.
        </Notice>
      ) : null}
      <div className="max-h-[60vh] min-h-[240px] overflow-y-auto bg-[#efeae2] p-4">
        <ConversationThread messages={data.messages} tz={tz} />
      </div>
    </Card>
  );
}

export default function ConversationsPage() {
  const { tz } = useTenant();
  const [filter, setFilter] = useState<ConversationFilter>('active');
  const [selected, setSelected] = useState<string | null>(null);
  const status = useReceptionistStatus();
  const list = useConversations(filter);
  const llmConfigured = Boolean(status.data?.llm.configured);

  return (
    <>
      <PageHeader
        title="Conversas"
        description="Atendimentos da recepcionista e da equipe, com o que foi consultado na agenda."
      />
      <Notice tone="info" title="Canais ainda não conectados" className="mb-5">
        WhatsApp e telefone entram com a integração oficial dos canais (exige contas na Meta e em um provedor
        de telefonia). Até lá, os testes feitos no simulador do Voice Studio aparecem em “Simulações”.
        {status.data && !llmConfigured
          ? ' O modelo de linguagem da recepcionista também ainda não está integrado.'
          : ''}
      </Notice>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar conversas">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => {
              setFilter(f.value);
              setSelected(null);
            }}
            className={cn(
              'h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition',
              filter === f.value
                ? 'bg-ink-900 text-paper'
                : 'bg-white text-ink-600 shadow-card hover:bg-ink-50',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className={cn('p-2', selected && 'hidden lg:block')}>
          {list.isPending ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : list.data && list.data.length ? (
            <div className="flex flex-col">
              {list.data.map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  tz={tz}
                  active={selected === c.id}
                  onSelect={() => setSelected(c.id)}
                />
              ))}
            </div>
          ) : (
            <CardBody className="pt-5">
              <EmptyState
                icon={<MessagesSquare className="size-5" />}
                title="Nenhuma conversa"
                description={
                  filter === 'simulations'
                    ? 'Teste a recepcionista no simulador do Voice Studio.'
                    : 'As conversas aparecem aqui quando os canais estiverem conectados.'
                }
              />
            </CardBody>
          )}
        </Card>
        <div className={cn(!selected && 'hidden lg:block')}>
          {selected ? (
            <ConversationDetail
              id={selected}
              onBack={() => setSelected(null)}
              llmConfigured={llmConfigured}
            />
          ) : (
            <Card className="flex min-h-[240px] items-center justify-center p-6">
              <p className="text-sm text-ink-400">Selecione uma conversa para ver o atendimento.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
