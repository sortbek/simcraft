'use client';

import Select from './Select';
import { useLanguage } from '../../lib/i18n';

// Secondary stat IDs (backend `stat.id`): Crit=32, Haste=36, Mastery=49, Vers=40.
const STAT_KEY: Record<number, string> = {
  32: 'stat.criticalStrike',
  36: 'stat.haste',
  49: 'stat.mastery',
  40: 'stat.versatility',
};

// Crafted gear takes two equal, unorderable secondary stats: the 6 pairs.
const STAT_ORDER = [32, 36, 49, 40];
export const PREFERRED_STAT_COMBOS: [number, number][] = STAT_ORDER.flatMap((a, i) =>
  STAT_ORDER.slice(i + 1).map((b): [number, number] => [a, b])
);

export const DEFAULT_PREFERRED_STATS: [number, number] = [32, 36]; // Crit/Haste

interface PreferredStatsSelectProps {
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

export default function PreferredStatsSelect({ value, onChange }: PreferredStatsSelectProps) {
  const { t } = useLanguage();
  const options = PREFERRED_STAT_COMBOS.map((combo) => ({
    value: combo,
    label: `${t(STAT_KEY[combo[0]])}/${t(STAT_KEY[combo[1]])}`,
  }));

  return (
    <Select
      value={value}
      onChange={onChange}
      isEqual={(a, b) => a[0] === b[0] && a[1] === b[1]}
      options={options}
    />
  );
}
