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

// Display order for the classic four; also the fallback when the season
// config doesn't supply its own stat list.
const STAT_ORDER = [32, 36, 49, 40];

export const DEFAULT_PREFERRED_STATS: [number, number] = [32, 36]; // Crit/Haste

interface PreferredStatsSelectProps {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** This season's missive stat ids (season-config `craftedSecondaryStats`). */
  statIds?: number[];
}

export default function PreferredStatsSelect({
  value,
  onChange,
  statIds,
}: PreferredStatsSelectProps) {
  const { t } = useLanguage();
  const stats =
    statIds && statIds.length >= 2
      ? [
          ...STAT_ORDER.filter((s) => statIds.includes(s)),
          ...statIds.filter((s) => !STAT_ORDER.includes(s)),
        ]
      : STAT_ORDER;
  // Crafted gear takes two equal, unorderable secondary stats: all pairs.
  const combos = stats.flatMap((a, i) => stats.slice(i + 1).map((b): [number, number] => [a, b]));
  const statLabel = (id: number) => (STAT_KEY[id] ? t(STAT_KEY[id]) : `#${id}`);
  const options = combos.map((combo) => ({
    value: combo,
    label: `${statLabel(combo[0])}/${statLabel(combo[1])}`,
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
