import { useEffect, type RefObject } from 'react';

/** Close a popover on a mousedown outside `ref` or on Escape, while `open`.
 *  `trigger` (a portalled popover's toggle button) is ignored, so it can close
 *  the popover itself instead of re-opening it. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
  trigger?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (trigger?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close, trigger]);
}
