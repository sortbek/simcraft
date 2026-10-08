'use client';

/** Top Gear's Consumables tab: one line per consumable slot, one pill per
 *  current-expansion consumable. The Sim settings pick is the baseline and is
 *  marked Current; every other pill adds an alternative, and Top Gear sims
 *  every mix of them with every gear combo. */
/* eslint-disable @next/next/no-img-element */

import { useMemo } from 'react';
import { GEAR_ROW_METRICS, type GearRowDensity } from './gearDensity';
import { iconProps } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { CONSUMABLE_LABELS } from '../../lib/sim-config-defaults';
import {
  SLOT_SOURCES,
  buildGroups,
  qualitiesOf,
  useConsumableData,
  type ConsumableGroup,
} from '../sim-config/ConsumablePickers';
import {
  baseOf,
  consumableMixCount,
  effectiveConsumableOptions,
  type ConsumableOptions,
} from '../../lib/consumableOptions';

/** The value a pill adds: its best crafted quality. */
const bestValue = (group: ConsumableGroup) => {
  const qualities = qualitiesOf(group);
  return group.variants[qualities.length ? qualities[qualities.length - 1] : 0];
};

export default function ConsumableAlternatives({
  options,
  baseline,
  onChange,
  density = 'comfortable',
}: {
  options: ConsumableOptions;
  /** The consumables combos are compared against (slot -> value). */
  baseline: Record<string, string>;
  onChange: (slot: string, values: string[]) => void;
  density?: GearRowDensity;
}) {
  const { t } = useLanguage();
  const data = useConsumableData();
  const metrics = GEAR_ROW_METRICS[density];

  const rows = useMemo(
    () =>
      data
        ? SLOT_SOURCES.map(({ key, field }) => ({
            slot: key,
            groups: buildGroups(data[field] ?? []).filter((g) => g.current),
          })).filter((row) => row.groups.length > 0)
        : [],
    [data]
  );

  if (!data) {
    return <p className="py-1 text-sm text-outline">{t('common.loading')}</p>;
  }

  const mixes = consumableMixCount(effectiveConsumableOptions(options, baseline));

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-on-surface-variant">
        {t(mixes === 1 ? 'consumables.mixesOne' : 'consumables.mixes', { count: mixes })}
        <span className="ml-2 text-outline">{t('consumables.hint')}</span>
      </p>

      {rows.map(({ slot, groups }) => {
        const baseGroup = baseline[slot] ? baseOf(baseline[slot]) : '';
        const picks = options[slot] ?? [];
        return (
          <div key={slot} className="flex items-start gap-2">
            <span className="lbl w-[104px] shrink-0 pt-3">{CONSUMABLE_LABELS[slot]}</span>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {groups.map((group) => {
                const isBaseline = group.base === baseGroup;
                const picked = picks.some((v) => baseOf(v) === group.base);
                const toggle = () =>
                  onChange(
                    slot,
                    picked
                      ? picks.filter((v) => baseOf(v) !== group.base)
                      : [...picks, bestValue(group)]
                  );
                return (
                  <button
                    key={group.base}
                    type="button"
                    aria-pressed={isBaseline || picked}
                    disabled={isBaseline}
                    onClick={toggle}
                    className={`flex items-center rounded-[7px] border transition-colors duration-[120ms] ${metrics.row} ${
                      isBaseline
                        ? 'cursor-default border-gold-edge bg-surface-container-high text-on-surface'
                        : picked
                          ? 'border-gold-edge bg-gold-tint text-on-surface'
                          : 'border-line/[0.06] bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                    }`}
                  >
                    <img
                      {...iconProps(group.icon)}
                      alt=""
                      className={`${metrics.icon} shrink-0 rounded-[5px] border border-line/[0.11]`}
                    />
                    <span className={`${metrics.name} font-semibold`}>{group.name}</span>
                    {group.stat && <span className="text-[11.5px] text-outline">{group.stat}</span>}
                    {isBaseline && (
                      <span className="font-headline text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-gold">
                        {t('consumables.current')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
