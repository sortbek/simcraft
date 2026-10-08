'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import Checkbox from '../ui/Checkbox';
import Switch from '../ui/Switch';
import { useDismiss } from '../../lib/useDismiss';
import { iconProps } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { cn } from '../../lib/cn';

export type BuildGroup = 'active' | 'game' | 'saved' | 'custom';

export interface BuildOption {
  /** Index into the picker's loadout list. */
  index: number;
  name: string;
  group: BuildGroup;
  heroName?: string | null;
  heroIcon?: string | null;
  /** Set for a build of another spec, whose changes can't be counted. */
  specLabel?: string;
  /** Talents that differ from the equipped build; null when unknown. */
  changes?: number | null;
}

/** A loadout's name without what its group and spec label already say:
 *  "[Beast Mastery] Saved Loadout: Drakes" reads "Drakes". */
export const displayName = (name: string) =>
  name.replace(/^\[[^\]]+\]\s*/, '').replace(/^Saved Loadout:\s*/i, '');

const PREVIEW_WIDTH = 340;

const GROUPS: { group: BuildGroup; label: string }[] = [
  { group: 'active', label: 'talent.groupEquipped' },
  { group: 'game', label: 'talent.groupInGame' },
  { group: 'saved', label: 'talent.groupSaved' },
  { group: 'custom', label: 'talent.groupCustom' },
];

export function HeroIcon({ icon, className }: { icon?: string | null; className?: string }) {
  return icon ? (
    <img
      {...iconProps(icon)}
      alt=""
      className={cn('shrink-0 rounded-[6px] border border-line/[0.11] object-cover', className)}
    />
  ) : (
    <span
      className={cn(
        'block shrink-0 rounded-[6px] border border-dashed border-line/20 bg-surface-container-high',
        className
      )}
    />
  );
}

/** Searchable, grouped talent build picker. With `compare`, a switch turns the
 *  list into checkboxes so several builds can be simmed against each other. */
export default function BuildPicker({
  options,
  selected,
  onSelect,
  compare,
  renderPreview,
}: {
  options: BuildOption[];
  selected: number;
  onSelect: (index: number) => void;
  /** What a hovered build changes, shown in a panel beside the list. */
  renderPreview?: (index: number) => ReactNode;
  compare?: {
    on: boolean;
    onToggle: (on: boolean) => void;
    checked: Set<number>;
    onCheck: (index: number) => void;
  };
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<number | null>(null);
  // The preview sits right of the list, so only where the window has room.
  const [previewFits, setPreviewFits] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHovered(null);
  }, []);
  const openMenu = () => {
    const right = rootRef.current?.getBoundingClientRect().right ?? Infinity;
    setPreviewFits(right + PREVIEW_WIDTH + 24 < window.innerWidth);
    setOpen(true);
  };
  useDismiss(rootRef, open, close);

  const current = options.find((o) => o.index === selected) ?? options[0];
  const comparing = !!compare?.on;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => displayName(o.name).toLowerCase().includes(q)) : options;
  }, [options, query]);

  const pick = (o: BuildOption) => {
    if (comparing) {
      compare!.onCheck(o.index);
      return;
    }
    onSelect(o.index);
    close();
  };

  const meta = (o: BuildOption) => o.specLabel ?? o.heroName ?? '';
  const changeText = (o: BuildOption) =>
    o.group === 'active'
      ? t('talent.equippedLower')
      : o.changes == null
        ? ''
        : o.changes === 0
          ? t('talent.same')
          : t(o.changes === 1 ? 'talent.changeOne' : 'talent.changes', { count: o.changes });

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-[38px] w-full items-center gap-2.5 rounded-[7px] border bg-surface-container-high pl-1.5 pr-2.5 text-left transition-colors',
          open ? 'border-gold-edge' : 'border-line/[0.11] hover:border-line/20'
        )}
      >
        <HeroIcon icon={current?.heroIcon} className="h-[26px] w-[26px]" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-on-surface">
          {comparing && compare!.checked.size > 1
            ? t('talent.buildsSelected', { count: compare!.checked.size })
            : current && displayName(current.name)}
        </span>
        <svg
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-outline transition-transform',
            open && 'rotate-180'
          )}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-full min-w-[300px]">
          {renderPreview && previewFits && hovered != null && (
            <div
              className="popover absolute left-[calc(100%+8px)] top-0 p-3.5"
              style={{ width: PREVIEW_WIDTH }}
            >
              {renderPreview(hovered)}
            </div>
          )}
          <div className="popover overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line/[0.06] p-2.5">
              <svg
                className="ml-1 h-3.5 w-3.5 shrink-0 text-outline"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches[0]) pick(matches[0]);
                }}
                placeholder={t('talent.searchBuilds', { count: options.length })}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-on-surface outline-none placeholder:text-outline"
              />
            </div>

            {compare && (
              <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-line/[0.06] px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-on-surface">
                    {t('talent.compareBuilds')}
                  </span>
                  <span className="block text-[11.5px] text-outline">
                    {comparing && compare.checked.size > 1
                      ? t('talent.buildsGearCombos', { count: compare.checked.size })
                      : t('talent.compareHint')}
                  </span>
                </span>
                <Switch
                  checked={comparing}
                  onChange={compare.onToggle}
                  aria-label={t('talent.compareBuilds')}
                />
              </label>
            )}

            <div role="listbox" className="max-h-[360px] overflow-y-auto overscroll-contain p-1.5">
              {GROUPS.map(({ group, label }) => {
                const rows = matches.filter((o) => o.group === group);
                if (!rows.length) return null;
                return (
                  <div key={group}>
                    <div className="flex items-center justify-between px-2 pb-1.5 pt-2.5">
                      <span className="lbl">{t(label)}</span>
                      <span className="text-[11.5px] text-outline">{rows.length}</span>
                    </div>
                    {rows.map((o) => {
                      const isCurrent = o.index === selected;
                      const checked = comparing && compare!.checked.has(o.index);
                      return (
                        <button
                          key={o.index}
                          type="button"
                          role="option"
                          aria-selected={comparing ? checked : isCurrent}
                          onClick={() => pick(o)}
                          onMouseEnter={() => setHovered(o.index)}
                          onFocus={() => setHovered(o.index)}
                          className={cn(
                            'group flex w-full items-center gap-2.5 rounded-[7px] border px-2 py-1.5 text-left transition-colors',
                            (comparing ? checked : isCurrent)
                              ? 'border-gold-edge bg-gold-tint'
                              : 'border-transparent hover:bg-surface-container-highest'
                          )}
                        >
                          {comparing && <Checkbox checked={checked} size="sm" />}
                          <HeroIcon icon={o.heroIcon} className="h-[26px] w-[26px]" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[13px] font-semibold text-on-surface">
                              {displayName(o.name)}
                            </span>
                            {meta(o) && (
                              <span className="truncate text-[11.5px] text-outline">{meta(o)}</span>
                            )}
                          </span>
                          <span className="shrink-0 text-[11.5px] font-semibold text-on-surface-variant">
                            {changeText(o)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {matches.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-outline">{t('talent.noMatches')}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
