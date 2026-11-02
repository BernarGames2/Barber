import { LogoMark } from './logo';

export function BrandLoader({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
    >
      <LogoMark className="size-11 animate-pulse" />
      <p className="text-sm text-ink-400">{label}</p>
    </div>
  );
}
