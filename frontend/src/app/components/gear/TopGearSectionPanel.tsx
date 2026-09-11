'use client';

import type { ReactNode } from 'react';
import ClearButton from '../ui/ClearButton';
import InfoIcon from '../ui/InfoIcon';

interface TopGearSectionPanelProps {
  /** Already-translated section name. */
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  /** Explains what the section does, shown as an info badge by the heading.
   *  Sits before the heading's flex-1 rule, so it moves where that rule starts
   *  and never where it ends — the headings stay aligned with or without it. */
  tooltip?: string;
  /** Tooltip/aria text for the clear button, e.g. "Clear Gems". */
  clearTitle: string;
  /** Visible text on the clear button. Identical across sections on purpose —
   *  a per-section label would reserve a different width in each heading and
   *  the hairline rules would stop at different x positions. */
  clearLabel: string;
  sectionRef?: (element: HTMLElement | null) => void;
  children: ReactNode;
}

/** One page section with a visible heading: name, count, a hairline rule across
 *  the remaining width, and a caret. That rule is the section's only separator:
 *  a border above the section as well reads as a double line. The heading is the
 *  only thing that expands and collapses the section — the toolbar just
 *  navigates to it.
 *
 *  Clear sits beside the heading as its own button rather than inside it, so
 *  clearing never also toggles, and it keeps its space at a count of zero so the
 *  heading can't shift. Not sticky; the toolbar is the sticky header. */
export default function TopGearSectionPanel({
  label,
  count,
  open,
  onToggle,
  onClear,
  tooltip,
  clearTitle,
  clearLabel,
  sectionRef,
  children,
}: TopGearSectionPanelProps) {
  return (
    <section ref={sectionRef} className="scroll-mt-28">
      <div className="mb-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="shrink-0 font-headline text-[13px] font-bold uppercase tracking-[0.2em] text-on-surface-variant transition-colors group-hover:text-on-surface">
            {label}
          </span>
          <span
            className={`min-w-[1.5rem] shrink-0 rounded px-1 py-px text-center text-[11px] font-bold tabular-nums transition-colors ${
              count > 0 ? 'bg-gold/15 text-gold' : 'bg-surface-container-highest text-muted'
            }`}
          >
            {count}
          </span>
          {tooltip && <InfoIcon tooltip={tooltip} />}
          <span className="h-px flex-1 bg-outline-variant/20" />
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-on-surface-variant/40 transition-transform duration-200 group-hover:text-on-surface-variant ${
              open ? 'rotate-180' : ''
            }`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        <ClearButton onClick={onClear} empty={count === 0} title={clearTitle} label={clearLabel} />
      </div>
      {/* Hidden rather than unmounted: `[hidden]` collapses the layout just as
          removing it would, but the selectors keep the enchant/gem options they
          fetched, so expanding again doesn't refetch everything. */}
      <div hidden={!open}>{children}</div>
    </section>
  );
}
