'use client';

import { TOOLTIP_WIDTH, TooltipBubble } from './Tooltip';
import { useAnchoredPopup } from './useAnchoredPopup';

/** Small "i" badge with a hover tooltip, used by the gem option switches and
 *  the loot browser. Clicks are swallowed so it can sit inside a clickable row
 *  without triggering it. */
export default function InfoIcon({ tooltip }: { tooltip: string }) {
  const { ref, show, hide, style } = useAnchoredPopup<HTMLSpanElement>(TOOLTIP_WIDTH, 'center');

  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-label={tooltip}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="relative inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-overlay/[0.06] text-outline outline-none transition-colors hover:bg-overlay/[0.11] hover:text-on-surface-variant focus-visible:ring-1 focus-visible:ring-gold/55"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-2.5 w-2.5"
      >
        <path
          fillRule="evenodd"
          d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0Zm-6 3.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7.293 5.293a1 1 0 1 1 .99 1.667c-.15.09-.293.21-.293.443V8a.75.75 0 1 0 1.5 0v-.297a2.5 2.5 0 1 0-3.447-2.66.75.75 0 0 0 1.5 0 1 1 0 0 1-.25-.75Z"
          clipRule="evenodd"
        />
      </svg>
      {style && <TooltipBubble text={tooltip} style={style} />}
    </span>
  );
}
