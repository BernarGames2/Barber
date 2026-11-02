import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { Notice } from '@/components/ui/card';

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-ink-150">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
          <Link href="/">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="font-display text-4xl tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-ink-400">Última atualização: {updated}</p>
        <Notice tone="warning" className="mt-6" title="Versão preliminar">
          Documento elaborado para o programa piloto. Deve ser revisado por assessoria jurídica antes do
          lançamento comercial.
        </Notice>
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink-700 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
      </main>
    </div>
  );
}
