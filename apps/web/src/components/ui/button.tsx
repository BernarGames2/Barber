import { Slot } from 'radix-ui';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

const variants = {
  primary:
    'bg-ink-900 text-paper hover:bg-ink-800 active:bg-ink-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] disabled:bg-ink-300',
  brass:
    'bg-brass-500 text-ink-950 hover:bg-brass-400 active:bg-brass-600 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] disabled:bg-brass-200',
  secondary: 'bg-white text-ink-900 shadow-card hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-300',
  ghost: 'text-ink-700 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-150 disabled:text-ink-300',
  danger: 'bg-rose-700 text-white hover:bg-rose-600 active:bg-rose-800 disabled:bg-rose-300',
  'danger-ghost': 'text-rose-700 hover:bg-rose-50 active:bg-rose-100',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    asChild = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const classes = cn(
    'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:active:scale-100',
    variants[variant],
    sizes[size],
    className,
  );
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  );
});
