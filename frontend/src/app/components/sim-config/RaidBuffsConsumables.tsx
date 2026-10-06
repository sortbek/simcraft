'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import {
  CONSUMABLE_LABELS,
  DEFAULT_EXPANSION_OPTIONS,
  DEFAULT_RAID_BUFFS,
  RAID_BUFF_LIST,
} from '../../lib/sim-config-defaults';
import { useLanguage } from '../../lib/i18n';
import { API_URL, apiUrl, fetchJsonOr } from '../../lib/api';
import { buttonClass } from '../ui/Button';

interface ConsumableEntry {
  value: string;
  shortName: string;
  name: string;
  itemId: number;
  icon: string;
  expansion: number;
  craftingQuality?: number;
}

// Current expansion for Midnight
const CURRENT_EXPANSION = 11;

function buildOptions(
  data: ConsumableEntry[],
  currentExpansion: number
): { value: string; label: string }[] {
  const current = data.filter((d) => d.expansion === currentExpansion);
  const previous = data.filter((d) => d.expansion < currentExpansion);
  const options: { value: string; label: string }[] = [
    { value: '', label: 'SimC Default' },
    { value: 'disabled', label: 'None' },
  ];
  // Add current expansion items first (highest quality only per unique base name)
  const seen = new Set<string>();
  for (const item of current) {
    const baseName = item.value.replace(/_\d+$/, '');
    if (!seen.has(baseName)) {
      seen.add(baseName);
      options.push({ value: item.value, label: item.name });
    }
  }
  // Add previous expansion items (grouped, highest quality)
  for (const item of previous) {
    const baseName = item.value.replace(/_\d+$/, '');
    if (!seen.has(baseName)) {
      seen.add(baseName);
      options.push({ value: item.value, label: item.name });
    }
  }
  return options;
}

const EXPANSION_OPTION_LIST = [
  { key: 'midnight.crucible_of_erratic_energies_violence', label: 'Crucible: Violence' },
  { key: 'midnight.crucible_of_erratic_energies_sustenance', label: 'Crucible: Sustenance' },
  { key: 'midnight.crucible_of_erratic_energies_predation', label: 'Crucible: Predation' },
] as const;

interface ConsumablesApiResponse {
  flasks: ConsumableEntry[];
  potions: ConsumableEntry[];
  foods: ConsumableEntry[];
  augments: ConsumableEntry[];
  weapon_runes: ConsumableEntry[];
}

const DEFAULT_OPTIONS = { value: '', label: 'SimC Default' };
const NONE_OPTION = { value: 'disabled', label: 'None' };
const EMPTY_OPTIONS = [DEFAULT_OPTIONS, NONE_OPTION];

export default function RaidBuffsConsumables() {
  const { t } = useLanguage();
  const {
    raidBuffs,
    setRaidBuffs,
    consumables,
    setConsumables,
    expansionOptions,
    setExpansionOptions,
  } = useSimContext();

  const [apiData, setApiData] = useState<ConsumablesApiResponse | null>(null);

  useEffect(() => {
    fetchJsonOr<ConsumablesApiResponse | null>(apiUrl('/api/consumables'), null).then(
      (d) => d && setApiData(d)
    );
  }, []);

  const consumableOptions = useMemo(() => {
    if (!apiData)
      return {
        food: EMPTY_OPTIONS,
        flask: EMPTY_OPTIONS,
        potion: EMPTY_OPTIONS,
        augmentation: EMPTY_OPTIONS,
        weapon_rune: EMPTY_OPTIONS,
      };
    return {
      food: buildOptions(apiData.foods, CURRENT_EXPANSION),
      flask: buildOptions(apiData.flasks, CURRENT_EXPANSION),
      potion: buildOptions(apiData.potions, CURRENT_EXPANSION),
      augmentation: buildOptions(apiData.augments, CURRENT_EXPANSION),
      weapon_rune: buildOptions(apiData.weapon_runes, CURRENT_EXPANSION),
    };
  }, [apiData]);

  const allBuffsOn = Object.values(raidBuffs).every(Boolean);
  const allBuffsOff = Object.values(raidBuffs).every((v) => !v);

  const isDefault =
    allBuffsOn &&
    Object.values(consumables).every((v) => !v) &&
    Object.values(expansionOptions).every(Boolean);

  function toggleBuff(key: string) {
    setRaidBuffs({ ...raidBuffs, [key]: !raidBuffs[key] });
  }

  function setAllBuffs(on: boolean) {
    const updated = { ...raidBuffs };
    for (const key of Object.keys(updated)) updated[key] = on;
    setRaidBuffs(updated);
  }

  function setConsumable(key: string, value: string) {
    setConsumables({ ...consumables, [key]: value });
  }

  function toggleExpansionOption(key: string) {
    setExpansionOptions({ ...expansionOptions, [key]: !expansionOptions[key] });
  }

  function resetAll() {
    setRaidBuffs({ ...DEFAULT_RAID_BUFFS });
    setConsumables({});
    setExpansionOptions({ ...DEFAULT_EXPANSION_OPTIONS });
  }

  return (
    <div className="space-y-4 pt-1">
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="lbl">{t('config.raidBuffs')}</label>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setAllBuffs(true)}
              className={`${buttonClass('text')} ${allBuffsOn ? '!text-gold' : ''}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setAllBuffs(false)}
              className={`${buttonClass('text')} ${allBuffsOff ? '!text-negative' : ''}`}
            >
              None
            </button>
            {!isDefault && (
              <button type="button" onClick={resetAll} className={buttonClass('text')}>
                Reset
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {RAID_BUFF_LIST.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleBuff(key)}
              className={`chip ${raidBuffs[key] ? 'chip-on' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Consumables */}
      <div className="space-y-2.5">
        <label className="label-text">{t('config.consumables')}</label>
        <div className="grid grid-cols-5 gap-3">
          {Object.entries(consumableOptions).map(([key, options]) => (
            <div key={key} className="space-y-2">
              <span className="lbl block">{CONSUMABLE_LABELS[key]}</span>
              <select
                value={consumables[key] || ''}
                onChange={(e) => setConsumable(key, e.target.value)}
                className="sel"
              >
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Expansion Options */}
      <div className="space-y-2.5">
        <label className="label-text">{t('config.expansionOptions')}</label>
        <div className="flex flex-wrap gap-2">
          {EXPANSION_OPTION_LIST.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleExpansionOption(key)}
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
