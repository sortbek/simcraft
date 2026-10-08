'use client';

import type { ReactNode } from 'react';
import Tooltip from './Tooltip';
import { cn } from '../../lib/cn';

/** An on/off option as a chip, styled like the toolbar controls (gold when on).
 *  Extras such as the Catalyst charge badge go in `children`, inside the chip
 *  but beside its button rather than nested in it. */
export default function OptionChip({
  checked,
  onChange,
  text,
  tooltip,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  text: string;
  tooltip?: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip text={tooltip}>
      <span
        className={cn(
          'inline-flex h-8 items-center whitespace-nowrap rounded-[7px] border font-headline text-[10.5px] font-extrabold uppercase tracking-[0.12em] transition-colors',
          checked
            ? 'border-gold-edge bg-gold-tint text-gold'
            : 'border-line/[0.11] text-outline hover:border-line/[0.22] hover:text-on-surface'
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={cn(
            'inline-flex h-full items-center gap-2 rounded-[7px] pl-3 uppercase outline-none focus-visible:ring-1 focus-visible:ring-gold/55',
            children ? 'pr-2' : 'pr-3'
          )}
        >
          <span
            className={cn(
              'flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border-[1.5px]',
              checked ? 'border-gold-fill bg-gold-fill text-on-primary' : 'border-line/25'
            )}
          >
            {checked && (
              <svg
                className="h-2.5 w-2.5"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 6.2l2.3 2.3 4.7-5" />
              </svg>
            )}
          </span>
          {text}
        </button>
        {children}
      </span>
    </Tooltip>
  );
}
