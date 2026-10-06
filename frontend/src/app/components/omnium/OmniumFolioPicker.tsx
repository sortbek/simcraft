'use client';

/** Omnium Folio rune picker: one line per folio row, one pill per rune.
 *
 *  Page-agnostic on purpose — it takes a selection and a change handler and
 *  nothing else, so any sim page can render it. `multi` lets a row hold several
 *  runes (Top Gear multiplies them into combinations); `single` makes a click
 *  replace the row's pick, which is what a page that can't multiply wants. */
/* eslint-disable @next/next/no-img-element */

import { useMemo } from 'react';
import { GEAR_ROW_METRICS, type GearRowDensity } from '../gear/gearDensity';
import { iconProps, getWowheadSpellUrl } from '../../lib/useItemInfo';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useOmniumTree } from '../../lib/useOmniumTree';
import { useLanguage } from '../../lib/i18n';
import { combinationCount, folioRows, runeLabel, type OmniumSelection } from './omniumSelection';

interface OmniumFolioPickerProps {
  /** nodeId → selected entry ids. */
  selections: OmniumSelection;
  /** The row's new picks after a click. The caller stores them — and is free to
   *  refuse, e.g. to keep at least one rune in a row the character wears. */
  onChange: (nodeId: number, entryIds: number[]) => void;
  /** `multi` (default) adds to a row's picks so they multiply into
   *  combinations; `single` replaces the row's pick. */
  mode?: 'multi' | 'single';
  density?: GearRowDensity;
}

export default function OmniumFolioPicker({
  selections,
  onChange,
  mode = 'multi',
  density = 'comfortable',
}: OmniumFolioPickerProps) {
  const { t, locale } = useLanguage();
  const tree = useOmniumTree();
  const metrics = GEAR_ROW_METRICS[density];

  const rows = useMemo(() => (tree ? folioRows(tree) : []), [tree]);
  const combos = combinationCount(selections);

  useWowheadTooltips([rows.length]);

  if (!tree) {
    return <p className="py-1 text-sm text-outline">{t('common.loading')}</p>;
  }
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-on-surface-variant">
        {/* Two keys rather than an English-only "{s}" suffix: German pluralises
            "Kombination" as "Kombinationen", so no trailing letter works. */}
        {t(combos === 1 ? 'omnium.combinationsOne' : 'omnium.combinations', { count: combos })}
        {mode === 'multi' && (
          <span className="ml-2 text-outline">{t('omnium.multiSelectHint')}</span>
        )}
      </p>

      {rows.map((row, rowIndex) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2">
          <span className="lbl w-14 shrink-0">{t('omnium.row', { number: rowIndex + 1 })}</span>
          {row.entries.map((entry) => {
            const picks = selections[row.id] ?? [];
            const selected = picks.includes(entry.id);
            const next =
              mode === 'single'
                ? [entry.id]
                : selected
                  ? picks.filter((id) => id !== entry.id)
                  : [...picks, entry.id];
            return (
              // The pill is the tooltip anchor itself: nesting a link inside a
              // button is invalid, and a link only around the name would make
              // the pill's biggest target navigate instead of toggle. A click
              // toggles; hovering anywhere on the pill shows the spell tooltip
              // (same preventDefault trick as GearItemRow).
              <a
                key={entry.id}
                href={getWowheadSpellUrl(entry.spellId, locale)}
                data-wowhead={`spell=${entry.spellId}`}
                role="button"
                aria-pressed={selected}
                onClick={(e) => {
                  e.preventDefault();
                  onChange(row.id, next);
                }}
                className={`flex cursor-pointer items-center rounded-[7px] border transition-colors duration-[120ms] ${metrics.row} ${
                  selected
                    ? 'border-gold-edge bg-gold-tint text-on-surface'
                    : 'border-line/[0.06] bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                }`}
              >
                <img
                  {...iconProps(entry.icon)}
                  alt=""
                  className={`${metrics.icon} shrink-0 rounded-[5px] border border-line/[0.11]`}
                />
                <span className={`${metrics.name} font-semibold`}>{runeLabel(entry.name)}</span>
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}
