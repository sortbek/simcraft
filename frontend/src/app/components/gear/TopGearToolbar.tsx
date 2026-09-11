'use client';

import type { ReactNode } from 'react';
import ClearButton from '../ui/ClearButton';
import ToggleButtonGroup from '../ui/ToggleButtonGroup';
import type { GearRowDensity } from './gearDensity';

export interface TopGearSection {
  key: string;
  /** Already-translated section name. */
  label: string;
  count: number;
  /** Open state, used for styling only — the toolbar never changes it. */
  open: boolean;
  /** Scrolls to the section. Deliberately not a toggle: expanding and
   *  collapsing belongs to the section's own header. */
  onNavigate: () => void;
  onClear: () => void;
}

interface TopGearToolbarProps {
  sections: TopGearSection[];
  density: GearRowDensity;
  onDensityChange: (density: GearRowDensity) => void;
  /** Quick-select chips; always mounted so the bar never re-flows. */
  quickSelect?: ReactNode;
  onResetAll: () => void;
  resetDisabled: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}

/** Single sticky header for the whole Top Gear page. Each section entry is
 *  navigation plus a clear — jump to the section, or empty its selections —
 *  and nothing here expands or collapses anything.
 *
 *  Every control keeps its footprint whatever the counts are: clears stay
 *  mounted and invisible at zero, count pills have a fixed min width. So
 *  selecting or clearing never shifts the bar. */
export default function TopGearToolbar({
  sections,
  density,
  onDensityChange,
  quickSelect,
  onResetAll,
  resetDisabled,
  t,
}: TopGearToolbarProps) {
  return (
    <div className="sticky top-14 z-30 -mx-8 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-outline-variant/20 bg-background/90 px-8 py-1.5 backdrop-blur-sm">
      <div className="flex items-center">
        {sections.map((section, index) => (
          <div key={section.key} className="flex items-center">
            {index > 0 && <span className="mx-1 h-4 w-px bg-outline-variant/30" />}
            <button
              type="button"
              onClick={section.onNavigate}
              title={t('topGear.jumpToSection', { section: section.label })}
              className={`group flex items-center gap-1.5 rounded-md px-2 py-1 font-headline text-[11px] font-bold uppercase tracking-widest transition-colors hover:bg-white/[0.04] ${
                section.open ? 'text-on-surface' : 'text-muted hover:text-on-surface-variant'
              }`}
            >
              {section.label}
              <span
                className={`min-w-[1.5rem] rounded px-1 py-px text-center text-[11px] font-bold tabular-nums tracking-normal transition-colors ${
                  section.count > 0
                    ? 'bg-gold/15 text-gold'
                    : 'bg-surface-container-highest text-muted'
                }`}
              >
                {section.count}
              </span>
            </button>
            {/* Always rendered so clearing one section can't slide the others. */}
            <ClearButton
              onClick={section.onClear}
              empty={section.count === 0}
              title={t('topGear.clearSection', { section: section.label })}
            />
          </div>
        ))}
      </div>

      {quickSelect}

      <div className="ml-auto flex items-center gap-2">
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
        <button
          type="button"
          onClick={onResetAll}
          disabled={resetDisabled}
          title={t('topGear.resetAllTooltip')}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-outline-variant/30 px-2.5 py-1 text-[11px] font-semibold text-on-surface-variant transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200 disabled:pointer-events-none disabled:opacity-40"
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
        </button>
      </div>
    </div>
  );
}
