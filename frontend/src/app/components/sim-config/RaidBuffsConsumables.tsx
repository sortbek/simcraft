'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSimContext, DEFAULT_RAID_BUFFS, DEFAULT_EXPANSION_OPTIONS } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { API_URL } from '../../lib/api';

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

const RAID_BUFF_LIST = [
  { key: 'bloodlust', label: 'Bloodlust' },
  { key: 'arcane_intellect', label: 'Arcane Intellect' },
  { key: 'power_word_fortitude', label: 'Power Word: Fortitude' },
  { key: 'mark_of_the_wild', label: 'Mark of the Wild' },
  { key: 'battle_shout', label: 'Battle Shout' },
  { key: 'mystic_touch', label: 'Mystic Touch (5% Phys)' },
  { key: 'chaos_brand', label: 'Chaos Brand (3% Magic)' },
  { key: 'skyfury', label: 'Skyfury' },
  { key: 'hunters_mark', label: "Hunter's Mark" },
  { key: 'bleeding', label: 'Bleeding' },
] as const;

const EXPANSION_OPTION_LIST = [
  { key: 'midnight.crucible_of_erratic_energies_violence', label: 'Crucible: Violence' },
  { key: 'midnight.crucible_of_erratic_energies_sustenance', label: 'Crucible: Sustenance' },
  { key: 'midnight.crucible_of_erratic_energies_predation', label: 'Crucible: Predation' },
] as const;

const CONSUMABLE_LABELS: Record<string, string> = {
  food: 'Food',
  flask: 'Flask',
  potion: 'Potion',
  augmentation: 'Augmentation',
  weapon_rune: 'Weapon Rune',
};

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
    fetch(`${API_URL}/api/consumables`)
      .then((r) => r.json())
      .then(setApiData)
      .catch(() => {});
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
      {/* Raid Buffs */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="label-text">{t('config.raidBuffs')}</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAllBuffs(true)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                allBuffsOn
                  ? 'bg-gold/15 text-gold'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setAllBuffs(false)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                allBuffsOff
                  ? 'bg-red-500/15 text-red-400'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant'
              }`}
            >
              None
            </button>
            {!isDefault && (
              <button
                type="button"
                onClick={resetAll}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RAID_BUFF_LIST.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleBuff(key)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                raidBuffs[key]
                  ? 'bg-gold/10 text-gold ring-1 ring-gold/30'
                  : 'bg-surface-container-high/50 text-on-surface-variant/40 ring-1 ring-outline-variant/10 hover:text-on-surface-variant/60'
              }`}
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
            <div key={key} className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-on-surface-variant/50">
                {CONSUMABLE_LABELS[key]}
              </span>
              <select
                value={consumables[key] || ''}
                onChange={(e) => setConsumable(key, e.target.value)}
                className="w-full rounded-md bg-surface-container-high/50 px-2 py-1.5 text-[11px] text-on-surface ring-1 ring-outline-variant/10 focus:outline-none focus:ring-1 focus:ring-gold/30"
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
        <div className="flex flex-wrap gap-1.5">
          {EXPANSION_OPTION_LIST.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleExpansionOption(key)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                expansionOptions[key]
                  ? 'bg-gold/10 text-gold ring-1 ring-gold/30'
                  : 'bg-surface-container-high/50 text-on-surface-variant/40 ring-1 ring-outline-variant/10 hover:text-on-surface-variant/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
