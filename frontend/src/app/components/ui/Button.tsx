import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'gold' | 'solid' | 'quiet' | 'text' | 'danger';
export type ButtonSize = 'default' | 'sm' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[6px] font-headline font-extrabold uppercase tracking-[0.12em] transition-colors disabled:pointer-events-none disabled:opacity-40';

const VARIANT: Record<ButtonVariant, string> = {
  gold: 'border border-gold-edge bg-gold-tint text-gold hover:border-gold/55 hover:bg-gold/20',
  solid:
    'border border-gold-fill bg-gold-fill text-on-primary [box-shadow:var(--btn-solid-shadow)] hover:bg-gold-fill-hover',
  quiet:
    'border border-line/[0.11] bg-surface-container/60 text-on-surface-variant backdrop-blur hover:border-line/20 hover:text-on-surface',
  text: '!px-2 text-outline hover:text-on-surface',
  danger: 'border border-negative/25 bg-negative/[0.08] text-negative hover:bg-negative/[0.14]',
};

// Icons shrink to 14px unless they set their own height (e.g. spinners).
const ICON = "[&_svg:not([class*='h-'])]:h-3.5 [&_svg:not([class*='h-'])]:w-3.5";

const SIZE: Record<ButtonSize, string> = {
  default: `h-9 px-3.5 text-[11.5px] ${ICON}`,
  sm: 'h-7 px-2.5 text-[11px]',
  lg: `h-11 px-[22px] text-[12.5px] ${ICON}`,
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

type ButtonAsButton = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'href'>;
type ButtonAsAnchor = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

/** Class string for a non-Button element that should look like one. */
export function buttonClass(variant: ButtonVariant = 'gold', size: ButtonSize = 'default') {
  return cn(BASE, VARIANT[variant], SIZE[size]);
}

/** Shared button primitive matching the UI-polish mock: gold-edged, solid gold,
 *  quiet, text-only and danger variants. Renders an `<a>` when `href` is given,
 *  otherwise a `<button>`. */
export default function Button({
  variant = 'gold',
  size = 'default',
  className,
  ...props
}: ButtonProps) {
  const classes = cn(buttonClass(variant, size), className);

  if ('href' in props) {
    const { children, ...rest } = props;
    return (
      <a className={classes} {...rest}>
        {children}
      </a>
    );
  }

  const { children, type = 'button', ...rest } = props;
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
