'use client';

import type { ReactNode } from 'react';
import Button from '../ui/Button';
import ClearButton from '../ui/ClearButton';
import Tooltip from '../ui/Tooltip';
import Pill from '../ui/Pill';
import { cn } from '../../lib/cn';
import type { GearRowDensity } from './gearDensity';

export interface TopGearSection {
  key: string;
  /** Already-translated section name. */
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  onClear: () => void;
  /** Explains what the section does; shown as the tab's hover tooltip. */
  tooltip?: string;
}

interface TopGearToolbarProps {
  sections: TopGearSection[];
  density: GearRowDensity;
  onDensityChange: (density: GearRowDensity) => void;
  /** The current tab's own options (the Items tab's option chips). */
  options?: ReactNode;
  /** Quick-select chips, shown with the Items tab. */
  quickSelect?: ReactNode;
  addItemOpen: boolean;
  onAddItemToggle: () => void;
  onResetAll: () => void;
  resetDisabled: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const ICON = {
  className: 'h-[15px] w-[15px]',
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const DENSITIES: { key: GearRowDensity; label: string; icon: ReactNode }[] = [
  {
    key: 'comfortable',
    label: 'topGear.densityLarge',
    icon: (
      <svg {...ICON}>
        <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      </svg>
    ),
  },
  {
    key: 'compact',
    label: 'topGear.densityCompact',
    icon: (
      <svg {...ICON}>
        <path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11" />
      </svg>
    ),
  },
  {
    key: 'ultra',
    label: 'topGear.densityUltra',
    icon: (
      <svg {...ICON}>
        <path d="M2.5 3h11M2.5 5.5h11M2.5 8h11M2.5 10.5h11M2.5 13h11" />
      </svg>
    ),
  },
];

/** Top Gear's header: underlined section tabs (each with its count and a clear)
 *  and Add item in a sticky bar, then a row with the current tab's options and
 *  quick-selects on the left and the view tools (density, Reset all) right. */
export default function TopGearToolbar({
  sections,
  density,
  onDensityChange,
  options,
  quickSelect,
  addItemOpen,
  onAddItemToggle,
  onResetAll,
  resetDisabled,
  t,
}: TopGearToolbarProps) {
  return (
    <>
      <div className="sticky top-0 z-30 -mx-8 !-mt-3 flex items-center gap-4 border-b border-line/[0.06] bg-background px-8">
        <div role="tablist" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5">
          {sections.map((section) => (
            <span key={section.key} className="flex shrink-0 items-center gap-1">
              <Tooltip text={section.tooltip}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={section.active}
                  onClick={section.onSelect}
                  className={cn(
                    'relative flex h-12 items-center gap-2 whitespace-nowrap font-headline text-[11px] font-extrabold uppercase tracking-[0.12em] transition-colors',
                    section.active ? 'text-on-surface' : 'text-outline hover:text-on-surface'
                  )}
                >
                  {section.label}
                  <Pill
                    variant={section.count > 0 ? 'gold' : 'neutral'}
                    size="sm"
                    className={`min-w-[1.25rem] justify-center !text-[10.5px] tabular-nums ${section.count > 0 ? '' : 'text-outline'}`}
                  >
                    {section.count}
                  </Pill>
                  {section.active && (
                    <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gold-fill" />
                  )}
                </button>
              </Tooltip>
              {/* Stays mounted whatever the state, so switching tabs or
                  picking an item never changes a tab's width. */}
              <ClearButton
                onClick={section.onClear}
                empty={section.count === 0}
                title={t('topGear.clearSection', { section: section.label })}
              />
            </span>
          ))}
        </div>
        <Button
          variant={addItemOpen ? 'quiet' : 'gold'}
          onClick={onAddItemToggle}
          aria-expanded={addItemOpen}
          className="shrink-0"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d={addItemOpen ? 'M3 3l10 10M13 3L3 13' : 'M8 3v10M3 8h10'} />
          </svg>
          {t('topGear.addItem')}
        </Button>
      </div>

      <div className="topgear-tools flex flex-wrap items-center gap-2">
        {options}
        {quickSelect}
        <span className="flex-1" />
        <span className="topgear-tools-density inline-flex items-center gap-0.5 rounded-[9px] border border-line/[0.06] p-[3px]">
          {DENSITIES.map(({ key, label, icon }) => (
            <Tooltip key={key} text={t(label)}>
              <button
                type="button"
                onClick={() => onDensityChange(key)}
                aria-pressed={density === key}
                aria-label={t(label)}
                className={cn(
                  'flex h-[26px] w-[30px] items-center justify-center rounded-[6px] transition-colors',
                  density === key
                    ? 'bg-[color:var(--tab-on-bg)] text-on-surface [box-shadow:var(--tab-on-shadow)]'
                    : 'text-outline hover:text-on-surface'
                )}
              >
                {icon}
              </button>
            </Tooltip>
          ))}
        </span>
        <Tooltip text={t('topGear.resetAllTooltip')}>
          <button
            type="button"
            onClick={onResetAll}
            disabled={resetDisabled}
            aria-label={t('topGear.resetAll')}
            // Gold while there is something to reset, so it reads as available.
            className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-gold-edge bg-gold-tint text-gold transition-colors hover:border-negative/25 hover:bg-negative/10 hover:text-negative disabled:pointer-events-none disabled:border-line/[0.11] disabled:bg-transparent disabled:text-outline disabled:opacity-40"
          >
            <svg {...ICON}>
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13 2v3h-3" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </>
  );
}
