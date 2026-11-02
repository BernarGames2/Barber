import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <LogoMark className="size-12" />
      <h1 className="font-display text-5xl">Página não encontrada</h1>
      <p className="max-w-sm text-ink-500">O endereço pode ter mudado ou não existe.</p>
      <Link href="/" className="text-sm font-medium underline underline-offset-4">
        Voltar ao início
      </Link>
    </div>
  );
}
