'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption<T> {
  value: T;
  label: string;
  sublabel?: string;
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

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (portal && panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, portal]);

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

  const optionButtons = options.map((opt) => {
    const isActive = isEqual(opt.value, value);
    return (
      <button
        key={String(opt.value)}
        type="button"
        onClick={() => {
          onChange(opt.value);
          setOpen(false);
        }}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium transition-colors ${
          isActive ? 'bg-gold/[0.06] text-gold' : 'text-on-surface hover:bg-surface-container-high'
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
    );
  });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
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
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container shadow-xl">
          {optionButtons}
        </div>
      )}
    </div>
  );
}
