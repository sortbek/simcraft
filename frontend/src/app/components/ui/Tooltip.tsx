'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopup } from './useAnchoredPopup';

export const TOOLTIP_WIDTH = 224;
const EDGE = 8;

/** A tooltip as wide as its text (up to TOOLTIP_WIDTH), centred under the
 *  anchor's middle and kept inside the window. Measured before paint. */
export function TooltipBubble({
  text,
  style,
  center,
}: {
  text: string;
  style: CSSProperties;
  center?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || center == null) return;
    const zoom = Number(style.zoom ?? 1);
    const width = el.getBoundingClientRect().width / zoom;
    const max = window.innerWidth / zoom - width - EDGE;
    setLeft(Math.min(Math.max(EDGE, center - width / 2), max));
  }, [center, text, style.zoom]);
  return createPortal(
    <span
      ref={ref}
      role="tooltip"
      className="popover pointer-events-none fixed z-[100] whitespace-normal rounded-[6px] px-3 py-2 text-center text-xs font-normal normal-case tracking-normal text-on-surface"
      style={{
        ...style,
        width: 'max-content',
        maxWidth: TOOLTIP_WIDTH,
        ...(center != null && {
          left: left ?? center,
          visibility: left == null ? 'hidden' : undefined,
        }),
      }}
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
      {tip.style && <TooltipBubble text={text} style={tip.style} center={tip.center} />}
    </span>
  );
}
