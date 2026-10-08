'use client';

import type { CSSProperties, FocusEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopup } from './useAnchoredPopup';

export const TOOLTIP_WIDTH = 224;

export function TooltipBubble({ text, style }: { text: string; style: CSSProperties }) {
  return createPortal(
    <span
      role="tooltip"
      className="popover pointer-events-none fixed z-[100] whitespace-normal rounded-[6px] px-3 py-2 text-center text-xs font-normal normal-case tracking-normal text-on-surface"
      style={style}
    >
      {text}
    </span>,
    document.body
  );
}

/** Hover / keyboard-focus tooltip around an inline control. */
export default function Tooltip({ text, children }: { text?: string; children: ReactNode }) {
  const tip = useAnchoredPopup<HTMLSpanElement>(TOOLTIP_WIDTH, 'center');
  if (!text) return <>{children}</>;
  // A mouse click focuses too; only keyboard focus should raise the tooltip.
  const onFocus = (e: FocusEvent) => {
    if ((e.target as HTMLElement).matches(':focus-visible')) tip.show();
  };
  return (
    <span
      ref={tip.ref}
      className="inline-flex"
      onMouseEnter={tip.show}
      onMouseLeave={tip.hide}
      onMouseDown={tip.hide}
      onFocus={onFocus}
      onBlur={tip.hide}
    >
      {children}
      {tip.style && <TooltipBubble text={text} style={tip.style} />}
    </span>
  );
}
