'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { usePopupDismissal } from './usePopupDismissal';
import { createPortal } from 'react-dom';

export interface SelectOption<T> {
  value: T;
  label: ReactNode;
  group?: string;
  sublabel?: ReactNode;
}

interface SelectProps<T> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Used to find/highlight the selected option. Defaults to Object.is. */
  isEqual?: (a: T, b: T) => boolean;
  /**
   * Render the option panel into a portal on `document.body`, positioned
   * from the trigger's bounding rect, instead of absolutely inside this
   * component. Needed when the trigger sits inside an overflow-hidden
   * ancestor that would otherwise clip the panel. Default behavior
   * (prop absent) is unchanged.
   */
  portal?: boolean;
}

/** Generic dropdown: trigger + outside-click-to-close + option panel. */
export default function Select<T>({
  value,
  options,
  onChange,
  isEqual = Object.is,
  portal = false,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [portalRect, setPortalRect] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const focusOnOpen = useRef(false);
  const close = useCallback(() => setOpen(false), []);
  usePopupDismissal(open, close, ref, panelRef, triggerRef);
  useEffect(() => {
    if (open && focusOnOpen.current) {
      const panel = panelRef.current;
      (
        panel?.querySelector<HTMLElement>('[aria-selected="true"]') ??
        panel?.querySelector<HTMLElement>('[role="option"]')
      )?.focus();
      focusOnOpen.current = false;
    }
  }, [open]);
  function panelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') {
      close();
      return;
    }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []
    );
    if (!buttons.length) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].focus();
  }
  // Portal panels are positioned once at open time; rather than tracking the
  // trigger's rect on every scroll, just close on scroll/resize (capture:
  // true to also catch scrolling containers, since scroll doesn't bubble).
  // Scrolling the panel's own option list must NOT close it — only a scroll
  // outside the panel (e.g. a table container scrolling the trigger out from
  // under the fixed panel) should.
  useEffect(() => {
    if (!open || !portal) return;
    function handleScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleResize() {
      setOpen(false);
    }
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open, portal]);

  const selected = options.find((o) => isEqual(o.value, value));

  function toggleOpen() {
    if (!open && portal) {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) {
        const gap = 4;
        const preferredHeight = 320; // matches the non-portal panel's max-h-80
        const spaceBelow = window.innerHeight - rect.bottom - gap;
        const spaceAbove = rect.top - gap;
        // Flip upward when there isn't enough room below but there's more
        // room above, so the panel never runs off the bottom of the viewport.
        if (spaceBelow < preferredHeight && spaceAbove > spaceBelow) {
          setPortalRect({
            left: rect.left,
            width: rect.width,
            bottom: window.innerHeight - rect.top + gap,
            maxHeight: Math.max(0, Math.min(preferredHeight, spaceAbove)),
          });
        } else {
          setPortalRect({
            left: rect.left,
            width: rect.width,
            top: rect.bottom + gap,
            maxHeight: Math.max(0, Math.min(preferredHeight, spaceBelow)),
          });
        }
      }
    }
    setOpen(!open);
  }

  const optionButtons = options.map((opt, index) => {
    const isActive = isEqual(opt.value, value);
    return (
      <div key={String(opt.value)}>
        {opt.group && opt.group !== options[index - 1]?.group && (
          <div className="px-3 py-1.5 text-xs text-on-surface-variant">{opt.group}</div>
        )}
        <button
          role="option"
          aria-selected={isActive}
          tabIndex={isActive ? 0 : -1}
          type="button"
          onClick={() => {
            onChange(opt.value);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium transition-colors ${
            isActive
              ? 'bg-gold/[0.06] text-gold'
              : 'text-on-surface hover:bg-surface-container-high'
          }`}
        >
          <span className="truncate">{opt.label}</span>
          {opt.sublabel && (
            <span
              className={`text-right text-xs tabular-nums ${isActive ? 'text-gold/70' : 'text-on-surface-variant/50'}`}
            >
              {opt.sublabel}
            </span>
          )}
        </button>
      </div>
    );
  });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              focusOnOpen.current = true;
              toggleOpen();
            } else panelRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
          }
        }}
        onClick={toggleOpen}
        className="input-field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="font-medium text-on-surface">{selected?.label ?? 'Select'}</span>
          {selected?.sublabel && (
            <span className="text-xs tabular-nums text-on-surface-variant">
              {selected.sublabel}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-on-surface-variant/40 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && portal && portalRect
        ? createPortal(
            <div
              ref={panelRef}
              id={listId}
              role="listbox"
              onKeyDown={panelKeyDown}
              style={{
                left: portalRect.left,
                width: portalRect.width,
                maxHeight: portalRect.maxHeight,
                ...(portalRect.top !== undefined
                  ? { top: portalRect.top }
                  : { bottom: portalRect.bottom }),
              }}
              className="fixed z-30 overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container shadow-xl"
            >
              {optionButtons}
            </div>,
            document.body
          )
        : null}

      {open && !portal && (
        <div
          ref={panelRef}
          id={listId}
          role="listbox"
          onKeyDown={panelKeyDown}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container shadow-xl"
        >
          {optionButtons}
        </div>
      )}
    </div>
  );
}
