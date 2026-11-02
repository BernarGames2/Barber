import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { VoiceBars } from '@/components/ui/spinner';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-ink-900 text-paper lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(40rem 28rem at 110% -10%, rgb(184 137 47 / 0.25), transparent 60%)',
          }}
        />
        <Link href="/" className="relative">
          <Logo tone="light" />
        </Link>
        <div className="relative max-w-md">
          <VoiceBars className="h-6 text-brass-400" bars={7} />
          <p className="mt-8 font-display text-[40px] leading-[1.08]">
            Cada ligação atendida, <em className="text-brass-300">cada horário no lugar certo.</em>
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-ink-300">
            A recepcionista consulta sua agenda real e só confirma o que foi gravado. Você acompanha tudo pelo
            painel.
          </p>
        </div>
        <p className="relative text-xs text-ink-500">
          Seus dados ficam isolados por estabelecimento e protegidos conforme a LGPD.
        </p>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="lg:hidden">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-rise">{children}</div>
        </div>
      </main>
    </div>
  );
}
