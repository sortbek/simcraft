'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useDismiss } from '../../lib/useDismiss';
import { useLanguage } from '../../lib/i18n';

interface DungeonDrawerProps {
  instances: { id: number; name: string }[];
  allLabel: string;
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}

export default function DungeonDrawer({
  instances,
  allLabel,
  selectedIds,
  onChange,
}: DungeonDrawerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const allSelected = instances.length > 0 && instances.every((i) => selectedIds.has(String(i.id)));
  const count = instances.filter((i) => selectedIds.has(String(i.id))).length;

  const summaryLabel = useMemo(() => {
    if (count === 0) return t('dropFinder.noneSelected') ?? 'None selected';
    if (allSelected) return allLabel;
    if (count === 1) {
      const sel = instances.find((i) => selectedIds.has(String(i.id)));
      return sel?.name ?? `${count} selected`;
    }
    return `${count} selected`;
  }, [count, allSelected, allLabel, instances, selectedIds, t]);

  const summaryDetail = useMemo(() => {
    if (count === 0) return t('dropFinder.chooseSource') ?? 'Choose at least one source';
    if (allSelected) return t('dropFinder.fullPool') ?? 'Full seasonal pool included';
    const names = instances.filter((i) => selectedIds.has(String(i.id))).map((i) => i.name);
    if (names.length <= 2) return names.join(' · ');
    return names.slice(0, 2).join(' · ') + ' …';
  }, [count, allSelected, instances, selectedIds, t]);

  function toggleInstance(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(next);
  }

  function toggleAll() {
    if (allSelected) {
      onChange(new Set());
    } else {
      onChange(new Set(instances.map((i) => String(i.id))));
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="input-field flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 truncate font-medium text-on-surface">{summaryLabel}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-on-surface-variant">
          {summaryDetail}
        </span>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-overlay/[0.08] px-1.5 text-[11px] font-bold tabular-nums text-on-surface-variant">
          {count}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-outline transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          className="popover absolute left-0 top-full z-40 mt-1.5 w-full min-w-[260px] p-1.5"
        >
          <button
            type="button"
            onClick={toggleAll}
            className="w-full rounded-[6px] px-2.5 py-2 text-left text-xs font-semibold text-gold transition-colors hover:bg-surface-container-highest"
          >
            {allSelected
              ? (t('dropFinder.deselectAll') ?? 'Deselect all')
              : (t('dropFinder.selectAll') ?? 'Select all')}
          </button>
          <div className="max-h-[320px] overflow-y-auto overscroll-contain">
            {instances.map((inst) => {
              const checked = selectedIds.has(String(inst.id));
              return (
                <label
                  key={inst.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleInstance(String(inst.id))}
                    className="h-4 w-4 accent-gold-fill"
                  />
                  {inst.name}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
