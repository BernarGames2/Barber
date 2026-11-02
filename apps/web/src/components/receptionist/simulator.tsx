'use client';

import type { ConversationDetailDto, CustomerTurnDto } from '@barber-voice/contracts';
import { useMutation } from '@tanstack/react-query';
import { MessageCircle, PhoneCall, RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useTenant } from '@/lib/session';
import { ConversationThread } from './conversation-thread';

type Channel = 'WHATSAPP' | 'PHONE';

/**
 * Simulador do Voice Studio: conversa com a recepcionista usando a configuração SALVA e a
 * agenda real em modo simulação (consultas reais; reservas, cancelamentos e remarcações não
 * são gravados). Só aparece funcional quando o modelo de linguagem está integrado.
 */
export function SimulatorCard({
  llmConfigured,
  configSaved,
  dirty,
}: {
  llmConfigured: boolean;
  configSaved: boolean;
  dirty: boolean;
}) {
  const { base, tz } = useTenant();
  const [channel, setChannel] = useState<Channel>('WHATSAPP');
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [conversation, setConversation] = useState<ConversationDetailDto | null>(null);
  const [lastSpeech, setLastSpeech] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () =>
      api<ConversationDetailDto>(`${base}/simulator/conversations`, {
        method: 'POST',
        body: { channel, contactPhone: phone, contactName: null },
      }),
    onSuccess: (c) => {
      setConversation(c);
      setLastSpeech(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const send = useMutation({
    mutationFn: (message: string) =>
      api<CustomerTurnDto>(`${base}/simulator/conversations/${conversation!.id}/messages`, {
        method: 'POST',
        body: { text: message },
      }),
    onSuccess: (r) => {
      setConversation(r.conversation);
      setLastSpeech(r.speech);
      setText('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!llmConfigured) {
    return (
      <Card>
        <CardHeader title="4. Simulador" />
        <CardBody className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
            <MessageCircle className="size-5" />
          </span>
          <div className="text-[13px] text-ink-500">
            <p className="font-medium text-ink-800">Modelo de linguagem não integrado</p>
            <p className="mt-1">
              O simulador conversa com a recepcionista usando a agenda real (sem gravar reservas). Ele fica
              disponível quando o servidor tiver um provedor de IA configurado — nada aqui é simulado com
              respostas prontas.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const handoff = conversation?.status === 'HANDOFF';
  const submit = () => {
    const t = text.trim();
    if (t && conversation && !send.isPending) send.mutate(t);
  };

  return (
    <Card>
      <CardHeader
        title="4. Simulador"
        description="Converse com a recepcionista antes de ativar os canais."
        action={
          conversation ? (
            <Button size="sm" variant="ghost" onClick={() => setConversation(null)}>
              <RotateCcw className="size-3.5" /> Nova
            </Button>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-3">
        <Notice tone="info">
          Consulta a agenda real; reservas, cancelamentos e remarcações <strong>não são gravados</strong>.
          Cada mensagem usa o modelo de IA (custo por uso).
        </Notice>
        {!configSaved ? (
          <Notice tone="warning">Salve a recepcionista para testá-la no simulador.</Notice>
        ) : dirty ? (
          <Notice tone="warning">Há alterações não salvas — o simulador usa a configuração salva.</Notice>
        ) : null}

        {!conversation ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Canal simulado">
              {(
                [
                  ['WHATSAPP', 'WhatsApp', MessageCircle],
                  ['PHONE', 'Ligação', PhoneCall],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={channel === value}
                  onClick={() => setChannel(value)}
                  className={cn(
                    'flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-medium ring-1 ring-inset transition',
                    channel === value
                      ? 'bg-ink-900 text-paper ring-ink-900'
                      : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50',
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            <Input
              type="tel"
              inputMode="tel"
              placeholder="Telefone de um cliente cadastrado (opcional)"
              aria-label="Telefone de um cliente cadastrado (opcional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button disabled={!configSaved} loading={start.isPending} onClick={() => start.mutate()}>
              Iniciar simulação
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[12px] text-ink-500">
              <Badge tone="info">Simulação</Badge>
              <span>{conversation.channel === 'PHONE' ? 'Ligação' : 'WhatsApp'}</span>
              {handoff ? <Badge tone="warning">Transferida para a equipe</Badge> : null}
            </div>
            <div className="max-h-[420px] min-h-[160px] overflow-y-auto rounded-xl bg-[#efeae2] p-3">
              <ConversationThread
                messages={conversation.messages}
                tz={tz}
                emptyText="Escreva como se fosse um cliente."
              />
            </div>
            {lastSpeech ? (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
                <span className="font-medium text-ink-800">Como seria falado: </span>
                {lastSpeech}
              </p>
            ) : null}
            {handoff ? (
              <Notice tone="warning">
                A recepcionista transferiu o atendimento
                {conversation.handoffReason ? ` (${conversation.handoffReason})` : ''}. Inicie uma nova
                simulação para continuar testando.
              </Notice>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Input
                  value={text}
                  maxLength={1000}
                  placeholder="Ex.: Quero cortar amanhã depois do almoço"
                  aria-label="Mensagem do cliente"
                  onChange={(e) => setText(e.target.value)}
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Enviar"
                  loading={send.isPending}
                  disabled={!text.trim()}
                >
                  {send.isPending ? null : <Send className="size-4" />}
                </Button>
              </form>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
