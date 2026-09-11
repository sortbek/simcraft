import { cn } from '../../lib/cn';

interface ClearButtonProps {
  onClick: () => void;
  /** Nothing to clear: the button greys out but keeps its footprint. */
  empty: boolean;
  /** Tooltip and accessible name, e.g. "Clear Gems". */
  title: string;
  /** Optional visible text. Keep it identical across sibling instances — a
   *  per-instance label reserves a different width in each one and anything
   *  laid out beside them stops lining up. */
  label?: string;
}

/** Destructive "clear this" control. Stays mounted and merely invisible when
 *  there is nothing to clear, so appearing and disappearing can never shift the
 *  row it sits in. */
export default function ClearButton({ onClick, empty, title, label }: ClearButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      aria-hidden={empty}
      aria-label={title}
      title={title}
      className={cn(
        'flex shrink-0 items-center justify-center gap-1.5 rounded transition-all hover:bg-red-500/10 hover:text-red-400',
        label
          ? 'h-6 gap-1.5 rounded-md border border-outline-variant/25 px-2 text-[11px] font-semibold text-on-surface-variant/70 hover:border-red-500/40 hover:text-red-300'
          : 'h-5 w-5 text-on-surface-variant/50',
        empty ? 'pointer-events-none opacity-0' : 'opacity-100'
      )}
    >
      <svg
        className="h-2.5 w-2.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <path d="M3 3l10 10M13 3L3 13" />
      </svg>
      {label}
    </button>
  );
}
