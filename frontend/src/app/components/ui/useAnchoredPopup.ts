'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useContentScale } from '../layout/ContentScaler';

const EDGE = 8;

/** Fixed-position placement below an anchor, for popups portalled to <body>:
 *  rendered inline, any ancestor that clips its overflow (cards, the setup bar,
 *  scrolling tab strips) cut them off. Closes when the page scrolls, since a
 *  fixed popup would otherwise stay put while its anchor moves. */
export function useAnchoredPopup<T extends HTMLElement>(width: number, align: 'center' | 'end') {
  const { scale } = useContentScale();
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // Content is zoomed by the scale slider; the popup takes the same zoom so
    // it matches, and its fixed coordinates are divided back out of it.
    const zoom = scale / 100;
    const w = width * zoom;
    const ideal = align === 'end' ? rect.right - w : rect.left + rect.width / 2 - w / 2;
    const left = Math.min(Math.max(EDGE, ideal), window.innerWidth - w - EDGE);
    setPos({ left: left / zoom, top: (rect.bottom + 8) / zoom });
  }, [scale, width, align]);
  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos, hide]);

  const style: CSSProperties | null = pos && {
    left: pos.left,
    top: pos.top,
    width,
    zoom: scale !== 100 ? scale / 100 : undefined,
  };
  return { ref, open: pos !== null, show, hide, style };
}
