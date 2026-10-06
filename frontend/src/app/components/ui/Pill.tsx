import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type PillVariant =
  | 'neutral'
  | 'gold'
  | 'positive'
  | 'negative'
  | 'info'
  | 'warning'
  | 'epic';

const VARIANT: Record<PillVariant, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  gold: 'bg-gold/10 text-gold',
  positive: 'bg-positive/10 text-positive',
  negative: 'bg-negative/10 text-negative',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  epic: 'bg-quality-epic/10 text-quality-epic',
};

/** Small tinted badge matching the UI-polish mock's `.pill` — 24px tall,
 *  uppercase Manrope 800 11px. */
export default function Pill({
  variant = 'neutral',
  size = 'md',
  className,
  children,
}: {
  variant?: PillVariant;
  /** `sm` (20px) fits inline in dense item rows. */
  size?: 'sm' | 'md';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[5px] font-headline text-[11px] font-extrabold uppercase tracking-[0.1em]',
        size === 'sm' ? 'h-5 px-1.5' : 'h-6 px-[9px]',
        VARIANT[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
