import { useEffect, type RefObject } from 'react';
/** Shared dismissal for inline panels, portal panels, and the slot filter. */
export function usePopupDismissal(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement>,
  panel?: RefObject<HTMLElement>,
  trigger?: RefObject<HTMLElement>
) {
  useEffect(() => {
    if (!open) return;
    function pointer(event: MouseEvent) {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel?.current?.contains(target)) close();
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        trigger?.current?.focus();
      }
    }
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('mousedown', pointer);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open, close, root, panel, trigger]);
}
