import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import Tooltip from './Tooltip';

/** One labelled field of a setup bar (see TalentPicker's `options`). */
export default function SetupCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="setup-cell">
      <span className="lbl">{label}</span>
      <div className="flex min-h-[34px] flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** An on/off option button for a SetupCell, styled like the page's buttons
 *  (gold when on). Extras such as a count badge go in `children`, inside the
 *  same border but beside the button rather than nested in it. */
export function SetupToggle({
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
          'inline-flex h-[34px] items-center whitespace-nowrap rounded-[6px] border font-headline text-[11px] font-extrabold uppercase tracking-[0.12em] transition-colors',
          checked
            ? 'border-gold-edge bg-gold-tint text-gold hover:border-gold/55'
            : 'border-line/[0.12] text-outline hover:border-line/[0.22] hover:text-on-surface'
        )}
      >
        <button
          type="button"
          aria-pressed={checked}
          onClick={() => onChange(!checked)}
          className={cn(
            'inline-flex h-full items-center gap-2 rounded-[6px] pl-[13px] uppercase outline-none focus-visible:ring-1 focus-visible:ring-gold/55',
            children ? 'pr-2' : 'pr-[13px]'
          )}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('h-3.5 w-3.5', !checked && 'opacity-60')}
            aria-hidden
          >
            <path d={checked ? 'M3.5 8.3l3 3 6-6.3' : 'M8 3.5v9M3.5 8h9'} />
          </svg>
          {text}
        </button>
        {children}
      </span>
    </Tooltip>
  );
}
