'use client';
import type { DifficultyDef, DifficultyGroup } from '../../lib/types';
import type { UpgradeTracks } from './types';
import Select from './Select';
const TRACK_SHORT: Record<string, string> = {
  Adventurer: 'Adv',
  Veteran: 'Vet',
  Champion: 'Champ',
  Hero: 'Hero',
  Myth: 'Myth',
};

const TRACK_COLORS: Record<string, string> = {
  Adventurer: 'text-green-400',
  Veteran: 'text-blue-400',
  Champion: 'text-purple-400',
  Hero: 'text-orange-400',
  Myth: 'text-amber-300',
};

interface DifficultySelectProps {
  value: string;
  onChange: (key: string) => void;
  difficulties: DifficultyDef[];
  difficultyGroups: DifficultyGroup[] | null;
  upgradeTracks: UpgradeTracks;
  isCrafted?: boolean;
}

function getDiffDetails(d: DifficultyDef, upgradeTracks: UpgradeTracks) {
  const trackLevels = d.track ? upgradeTracks[d.track] : null;
  const max = trackLevels?.at(-1)?.max_level ?? d.level;
  const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
  return { max, ilvl };
}

export default function DifficultySelect({
  value,
  onChange,
  difficulties,
  difficultyGroups,
  upgradeTracks,
  isCrafted,
}: DifficultySelectProps) {
  const groups = difficultyGroups ?? [{ label: '', difficulties }];
  const options = groups.flatMap((group) =>
    group.difficulties.map((d) => {
      const { max, ilvl } = getDiffDetails(d, upgradeTracks);
      const track = d.track && !isCrafted ? d.track : null;
      return {
        value: d.key,
        group: group.label,
        label: (
          <span className="flex items-center gap-2">
            <span>{d.label}</span>
            {track && (
              <span className={TRACK_COLORS[track]}>
                {TRACK_SHORT[track] ?? track} {d.level}/{max}
              </span>
            )}
          </span>
        ),
        sublabel: ilvl ? 'ilvl ' + ilvl : undefined,
      };
    })
  );
  return <Select value={value} options={options} onChange={onChange} />;
}
