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
        'flex shrink-0 items-center justify-center gap-1.5 rounded transition-all hover:bg-negative/10 hover:text-negative',
        label
          ? 'h-7 gap-1.5 rounded-[6px] border border-line/[0.11] px-2.5 font-headline text-[11px] font-extrabold uppercase tracking-[0.12em] text-outline hover:border-negative/25'
          : 'h-5 w-5 text-outline',
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
