'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { useDismiss } from '../../lib/useDismiss';
import { cn } from '../../lib/cn';
import type { DungeonCategory } from '../../lib/types';
import { BONUS_ROLL_CATEGORY } from './lootConfiguration';

interface CategoryTab {
  key: string;
  label: string;
}

type TabGroup = 'crafted' | 'pvp';

/** Crafted and PvP sources share one tab each, with a menu of their sources. */
function groupOf(key: string): TabGroup | null {
  if (key === 'crafted' || key === 'rare-profession') return 'crafted';
  if (key.startsWith('pvp')) return 'pvp';
  return null;
}

const TAB =
  'relative flex h-12 items-center gap-1.5 whitespace-nowrap font-headline text-[11px] font-extrabold uppercase tracking-[0.12em] transition-colors';

function Underline() {
  return <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gold-fill" />;
}

function GroupTab({
  label,
  tabs,
  category,
  onChange,
}: {
  label: string;
  tabs: CategoryTab[];
  category: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  const current = tabs.find((tab) => tab.key === category);
  return (
    <span ref={rootRef} className="relative">
      <button
        type="button"
        role="tab"
        aria-selected={!!current}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(TAB, current ? 'text-on-surface' : 'text-outline hover:text-on-surface')}
      >
        {current?.label ?? label}
        <svg
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
        {current && <Underline />}
      </button>
      {open && (
        <div role="menu" className="popover absolute left-0 top-full z-40 mt-1 min-w-[220px] p-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(tab.key);
                close();
              }}
              className={cn(
                'flex w-full rounded-[6px] px-2.5 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-surface-container-highest',
                tab.key === category ? 'text-gold' : 'text-on-surface-variant hover:text-on-surface'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

interface CategorySelectorProps {
  category: string;
  onChange: (key: string) => void;
  dungeonCats: { cat: DungeonCategory; instances: unknown[] }[];
  /** Bonus Rolls spans two pools, so it resolves to no single instance. Callers
   *  that run one instance at a time (the roster) leave it off. */
  includeBonusRoll?: boolean;
  className?: string;
}

/** Loot sources as underlined tabs; Crafted and PvP sources sit behind one
 *  tab each, so the row stays short. */
export default function CategorySelector({
  category,
  onChange,
  dungeonCats,
  includeBonusRoll = false,
  className,
}: CategorySelectorProps) {
  const { t } = useLanguage();
  const tabs = useMemo(() => {
    const result: CategoryTab[] = [];
    if (includeBonusRoll) result.push({ key: BONUS_ROLL_CATEGORY, label: t('loot.bonusRolls') });
    result.push({ key: 'raids', label: t('loot.raids') });
    for (const dc of dungeonCats) result.push({ key: dc.cat.key, label: dc.cat.label });
    return result;
  }, [dungeonCats, includeBonusRoll, t]);

  const plain = tabs.filter((tab) => !groupOf(tab.key));
  const crafted = tabs.filter((tab) => groupOf(tab.key) === 'crafted');
  const pvp = tabs.filter((tab) => groupOf(tab.key) === 'pvp');

  return (
    <div
      role="tablist"
      className={cn('flex flex-wrap items-center gap-x-5 border-b border-line/[0.06]', className)}
    >
      {plain.map((tab) => {
        const active = tab.key === category;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(TAB, active ? 'text-on-surface' : 'text-outline hover:text-on-surface')}
          >
            {tab.label}
            {active && <Underline />}
          </button>
        );
      })}
      {crafted.length > 0 && (
        <GroupTab
          label={t('loot.groupCrafted')}
          tabs={crafted}
          category={category}
          onChange={onChange}
        />
      )}
      {pvp.length > 0 && (
        <GroupTab label={t('loot.groupPvp')} tabs={pvp} category={category} onChange={onChange} />
      )}
    </div>
  );
}
