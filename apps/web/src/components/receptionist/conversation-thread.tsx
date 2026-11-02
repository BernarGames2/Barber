'use client';

import type { ConversationMessageDto } from '@barber-voice/contracts';
import { CalendarSearch, ShieldAlert, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { timeIn } from '@/lib/format';

const TOOL_ICONS: Record<string, typeof Wrench> = {
  consultar_horarios: CalendarSearch,
  interpretar_data: CalendarSearch,
};

/**
 * Linha do tempo de um atendimento: mensagens do cliente à esquerda, da recepcionista/equipe
 * à direita, e as ações das ferramentas no meio — transparência sobre o que a IA consultou e fez.
 */
export function ConversationThread({
  messages,
  tz,
  className,
  emptyText = 'Nenhuma mensagem ainda.',
}: {
  messages: ConversationMessageDto[];
  tz: string;
  className?: string;
  emptyText?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  if (!messages.length) {
    return <p className={cn('py-8 text-center text-sm text-ink-400', className)}>{emptyText}</p>;
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {messages.map((m) => {
        if (m.role === 'TOOL') {
          const Icon = m.toolError ? TriangleAlert : (TOOL_ICONS[m.toolName ?? ''] ?? Wrench);
          return (
            <div key={m.id} className="flex justify-center">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                  m.toolError ? 'bg-amber-50 text-amber-800' : 'bg-ink-100 text-ink-600',
                )}
              >
                <Icon className="size-3" aria-hidden />
                {m.content}
              </span>
            </div>
          );
        }
        if (m.role === 'SYSTEM') {
          return (
            <p key={m.id} className="text-center text-[11px] text-ink-400">
              {m.content}
            </p>
          );
        }
        const mine = m.role === 'ASSISTANT' || m.role === 'STAFF';
        return (
          <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug whitespace-pre-line shadow-sm',
                m.role === 'ASSISTANT' && 'rounded-br-md bg-[#d9fdd3] text-ink-900',
                m.role === 'STAFF' && 'rounded-br-md bg-ink-900 text-paper',
                m.role === 'CUSTOMER' && 'rounded-bl-md bg-white text-ink-900 ring-1 ring-ink-100',
              )}
            >
              {m.content}
            </div>
            <div className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-ink-400">
              <span>
                {m.role === 'STAFF' ? 'Equipe · ' : m.role === 'ASSISTANT' ? 'Recepcionista · ' : ''}
                {timeIn(m.createdAt, tz)}
              </span>
              {m.verification?.fallback ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <ShieldAlert className="size-3" aria-hidden /> Resposta segura enviada
                </span>
              ) : m.verification && m.verification.rejected > 0 ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <ShieldCheck className="size-3" aria-hidden />
                  Verificador corrigiu{' '}
                  {m.verification.rejected === 1 ? '1 versão' : `${m.verification.rejected} versões`}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
