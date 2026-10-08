'use client';

import type { ReactNode } from 'react';
import Button from '../ui/Button';
import ClearButton from '../ui/ClearButton';
import Tooltip from '../ui/Tooltip';
import Pill from '../ui/Pill';
import ToggleButtonGroup, { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';
import type { GearRowDensity } from './gearDensity';

export interface TopGearSection {
  key: string;
  /** Already-translated section name. */
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  onClear: () => void;
  /** Explains what the section does; shown as an info badge beside the tab. */
  tooltip?: string;
}

interface TopGearToolbarProps {
  sections: TopGearSection[];
  density: GearRowDensity;
  onDensityChange: (density: GearRowDensity) => void;
  /** Quick-select chips, shown with the Items tab. */
  quickSelect?: ReactNode;
  addItemOpen: boolean;
  onAddItemToggle: () => void;
  onResetAll: () => void;
  resetDisabled: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}

/** Single sticky header for the whole Top Gear page: one tab per section (with
 *  its count and a clear), the quick-select chips, Add item, density and Reset
 *  all. Lays out by its own width, so the tabs never squeeze the actions. */
export default function TopGearToolbar({
  sections,
  density,
  onDensityChange,
  quickSelect,
  addItemOpen,
  onAddItemToggle,
  onResetAll,
  resetDisabled,
  t,
}: TopGearToolbarProps) {
  return (
    <div className="topgear-toolbar sticky top-16 z-30 -mx-8 border-b border-line/[0.06] bg-background px-8 py-2">
      <div className="topgear-toolbar-row">
        <div className="topgear-toolbar-tabs">
          <div className={TABS_TRACK} role="tablist">
            {sections.map((section) => (
              <span key={section.key} className="flex shrink-0 items-center">
                <Tooltip text={section.tooltip}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={section.active}
                    onClick={section.onSelect}
                    className={`flex items-center gap-2 whitespace-nowrap ${tabClass(section.active)} !text-[10.5px]`}
                  >
                    {section.label}
                    <Pill
                      variant={section.count > 0 ? 'gold' : 'neutral'}
                      size="sm"
                      className={`min-w-[1.25rem] justify-center !text-[10.5px] tabular-nums ${section.count > 0 ? '' : 'text-outline'}`}
                    >
                      {section.count}
                    </Pill>
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
        </div>

        {quickSelect && <div className="topgear-toolbar-extra">{quickSelect}</div>}

        <div className="topgear-toolbar-actions">
          <Button
            variant={addItemOpen ? 'quiet' : 'gold'}
            onClick={onAddItemToggle}
            aria-expanded={addItemOpen}
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
          <span className="topgear-toolbar-density">
            <ToggleButtonGroup<GearRowDensity>
              value={density}
              onChange={onDensityChange}
              size="sm"
              options={[
                { key: 'comfortable', label: t('topGear.densityLarge') },
                { key: 'compact', label: t('topGear.densityCompact') },
                { key: 'ultra', label: t('topGear.densityUltra') },
              ]}
            />
          </span>
          <Button
            variant="text"
            onClick={onResetAll}
            disabled={resetDisabled}
            title={t('topGear.resetAllTooltip')}
            className="shrink-0 hover:!text-negative"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13 2v3h-3" />
            </svg>
            {t('topGear.resetAll')}
          </Button>
        </div>
      </div>
    </div>
  );
}
