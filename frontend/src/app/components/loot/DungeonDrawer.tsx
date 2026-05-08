'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';

interface DungeonDrawerProps {
  instances: { id: number; name: string }[];
  allKey: string;
  allLabel: string;
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}

export default function DungeonDrawer({
  instances,
  allKey,
  allLabel,
  selectedIds,
  onChange,
}: DungeonDrawerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

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
    <details
      className="overflow-hidden"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-1 items-center justify-between gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-high px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-on-surface">{summaryLabel}</span>
            <span className="text-xs text-on-surface-variant">{summaryDetail}</span>
          </div>
          <span className="flex h-7 min-w-7 items-center justify-center rounded-full border border-gold/20 bg-gold/10 px-2 text-xs font-bold text-on-surface">
            {count}
          </span>
        </div>
      </summary>

      <div className="pt-3">
        <div className="flex gap-3 pb-2 pt-3">
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-gold transition-colors hover:text-gold/80"
          >
            {allSelected
              ? (t('dropFinder.deselectAll') ?? 'Deselect all')
              : (t('dropFinder.selectAll') ?? 'Select all')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {instances.map((inst) => {
            const checked = selectedIds.has(String(inst.id));
            return (
              <label
                key={inst.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-outline-variant/10 bg-surface-container px-3 py-2.5 transition-colors hover:bg-surface-container-high"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleInstance(String(inst.id))}
                  className="h-4 w-4 accent-gold"
                />
                <span className="text-sm text-on-surface">{inst.name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
}
