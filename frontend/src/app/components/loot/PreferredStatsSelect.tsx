'use client';

import Select from './Select';

// Secondary stat IDs (backend `stat.id`): Crit=32, Haste=36, Mastery=49, Vers=40.
const STAT_LABEL: Record<number, string> = {
  32: 'Crit',
  36: 'Haste',
  49: 'Mastery',
  40: 'Vers',
};

// Crafted gear takes two equal, unorderable secondary stats: the 6 pairs.
const STAT_ORDER = [32, 36, 49, 40];
export const PREFERRED_STAT_COMBOS: [number, number][] = STAT_ORDER.flatMap((a, i) =>
  STAT_ORDER.slice(i + 1).map((b): [number, number] => [a, b])
);

export const DEFAULT_PREFERRED_STATS: [number, number] = [32, 36]; // Crit/Haste

const PREFERRED_STAT_OPTIONS = PREFERRED_STAT_COMBOS.map((combo) => ({
  value: combo,
  label: `${STAT_LABEL[combo[0]]}/${STAT_LABEL[combo[1]]}`,
}));

interface PreferredStatsSelectProps {
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

export default function PreferredStatsSelect({ value, onChange }: PreferredStatsSelectProps) {
  return (
    <Select
      value={value}
      onChange={onChange}
      isEqual={(a, b) => a[0] === b[0] && a[1] === b[1]}
      options={PREFERRED_STAT_OPTIONS}
    />
  );
}
