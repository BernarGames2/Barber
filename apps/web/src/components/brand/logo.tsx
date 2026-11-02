import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Marca Barber Voice: onda sonora cujas barras são inclinadas como as listras de um
 * poste de barbeiro — voz + ofício. Em latão sobre tinta.
 */
export function LogoMark({ className, title = 'Barber Voice' }: { className?: string; title?: string }) {
  const bars = [
    { x: 9.5, h: 9 },
    { x: 14.5, h: 17 },
    { x: 19.5, h: 23 },
    { x: 24.5, h: 15 },
    { x: 29.5, h: 9 },
  ];
  // id único por instância: com ids repetidos, o navegador usaria o gradiente de um logo
  // oculto (display:none, ex.: barra lateral no celular) e as barras não seriam pintadas
  const gradientId = `bv-brass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 40 40" className={cn('size-8', className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e1bf7c" />
          <stop offset="1" stopColor="#b8892f" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="#14120f" />
      <rect
        x="0.5"
        y="0.5"
        width="39"
        height="39"
        rx="10.5"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.08"
      />
      <g transform="skewX(-14) translate(5 0)">
        {bars.map((b) => (
          <rect
            key={b.x}
            x={b.x - 1.6}
            y={20 - b.h / 2}
            width="3.2"
            height={b.h}
            rx="1.6"
            fill={`url(#${gradientId})`}
          />
        ))}
      </g>
    </svg>
  );
}

export function Logo({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span
        className={cn(
          'text-[17px] font-semibold tracking-[-0.02em]',
          tone === 'dark' ? 'text-ink-900' : 'text-paper',
        )}
      >
        Barber
        <span className="font-display text-[19px] font-normal italic tracking-normal text-brass-500">
          {' '}
          Voice
        </span>
      </span>
    </span>
  );
}
