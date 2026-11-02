'use client';

import { Switch as RSwitch } from 'radix-ui';
import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/cn';

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      {label ? (
        <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
          <span className="text-sm font-medium text-ink-800">{label}</span>
          {description ? <span className="text-[13px] text-ink-400">{description}</span> : null}
        </label>
      ) : null}
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-6 w-10 shrink-0 cursor-pointer rounded-full bg-ink-200 transition-colors data-[state=checked]:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
    </div>
  );
}
