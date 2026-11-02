'use client';

import { X } from 'lucide-react';
import { Dialog as RDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Diálogo responsivo: centralizado no desktop, "bottom sheet" no celular.
 * Acessível (foco preso, Esc fecha, título obrigatório para leitores de tela).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[size];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-[2px] animate-fade-in" />
        <RDialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl bg-white shadow-pop animate-rise focus:outline-none',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            width,
          )}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-ink-150 sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              <RDialog.Title className="text-lg font-semibold tracking-tight text-ink-900">
                {title}
              </RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-sm text-ink-500">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">Diálogo</RDialog.Description>
              )}
            </div>
            <RDialog.Close
              className="-mr-1 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              aria-label="Fechar"
            >
              <X className="size-5" />
            </RDialog.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-3 sm:px-6">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end sm:px-6 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
