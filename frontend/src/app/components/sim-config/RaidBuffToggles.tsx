'use client';
/* eslint-disable @next/next/no-img-element */

import { useSimContext } from './SimContext';
import {
  DEFAULT_EXPANSION_OPTIONS,
  DEFAULT_RAID_BUFFS,
  RAID_BUFF_LIST,
} from '../../lib/sim-config-defaults';
import { useLanguage } from '../../lib/i18n';
import { iconProps } from '../../lib/useItemInfo';
import { buttonClass } from '../ui/Button';

const EXPANSION_OPTION_LIST = [
  { key: 'midnight.crucible_of_erratic_energies_violence', label: 'Crucible: Violence' },
  { key: 'midnight.crucible_of_erratic_energies_sustenance', label: 'Crucible: Sustenance' },
  { key: 'midnight.crucible_of_erratic_energies_predation', label: 'Crucible: Predation' },
] as const;

/** Raid buffs column of the Sim settings block, plus the expansion options. */
export default function RaidBuffToggles() {
  const { t } = useLanguage();
  const {
    raidBuffs,
    setRaidBuffs,
    expansionOptions,
    setExpansionOptions,
    consumables,
    setConsumables,
  } = useSimContext();
  const isDefault =
    Object.entries(DEFAULT_RAID_BUFFS).every(([k, v]) => !!raidBuffs[k] === v) &&
    Object.values(consumables).every((v) => !v) &&
    Object.entries(DEFAULT_EXPANSION_OPTIONS).every(([k, v]) => !!expansionOptions[k] === v);
  const resetAll = () => {
    setRaidBuffs({ ...DEFAULT_RAID_BUFFS });
    setConsumables({});
    setExpansionOptions({ ...DEFAULT_EXPANSION_OPTIONS });
  };
  const onCount = RAID_BUFF_LIST.filter(({ key }) => raidBuffs[key]).length;

  const setAll = (on: boolean) =>
    setRaidBuffs(Object.fromEntries(Object.keys(raidBuffs).map((k) => [k, on])));

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="lbl">
            {t('simSettings.buffsActive', { on: onCount, total: RAID_BUFF_LIST.length })}
          </span>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setAll(true)}
              className={`${buttonClass('text', 'sm')} ${onCount === RAID_BUFF_LIST.length ? '!text-gold' : ''}`}
            >
              {t('simSettings.all')}
            </button>
            <button
              type="button"
              onClick={() => setAll(false)}
              className={`${buttonClass('text', 'sm')} ${onCount === 0 ? '!text-negative' : ''}`}
            >
              {t('simSettings.none')}
            </button>
            {!isDefault && (
              <button
                type="button"
                onClick={resetAll}
                title={t('simSettings.resetBuffsHint')}
                className={buttonClass('text', 'sm')}
              >
                {t('common.reset')}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
          {RAID_BUFF_LIST.map(({ key, label, icon }) => {
            const on = !!raidBuffs[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                title={label}
                onClick={() => setRaidBuffs({ ...raidBuffs, [key]: !on })}
                className={`flex min-w-0 items-center gap-2 rounded-[7px] border px-2 py-1.5 text-left text-[12.5px] font-semibold transition-colors ${
                  on
                    ? 'border-gold-edge bg-gold/[0.06] text-on-surface'
                    : 'border-line/[0.06] text-outline hover:text-on-surface-variant'
                }`}
              >
                <img
                  alt=""
                  {...iconProps(icon)}
                  className={`h-6 w-6 shrink-0 rounded-[5px] border object-cover ${
                    on ? 'border-gold-edge' : 'border-line/[0.11] opacity-45 grayscale'
                  }`}
                />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <span className="lbl block">{t('config.expansionOptions')}</span>
        <div className="flex flex-wrap gap-1.5">
          {EXPANSION_OPTION_LIST.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setExpansionOptions({ ...expansionOptions, [key]: !expansionOptions[key] })
              }
              className={`chip ${expansionOptions[key] ? 'chip-on' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
