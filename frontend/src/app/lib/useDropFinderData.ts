import { useEffect, useMemo, useState } from 'react';
import { API_URL } from './api';
import type { SeasonConfigResponse, DungeonCategory } from './types';
import {
  detectClass,
  detectSpec,
  type DropItem,
  type Instance,
  type UpgradeTracks,
} from '../components/loot/types';

export type Category = 'raids' | string;

export const PVP_KEYS = ['pvp-conquest', 'pvp-honor', 'pvp-bloody-tokens', 'pvp-profession'];
export const PROFESSION_KEYS = ['crafted', 'rare-profession'];

export const TRACK_SHORT: Record<string, string> = {
  Adventurer: 'Adv',
  Veteran: 'Vet',
  Champion: 'Champ',
  Hero: 'Hero',
  Myth: 'Myth',
};

export const TRACK_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Adventurer: { text: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30' },
  Veteran: { text: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
  Champion: { text: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30' },
  Hero: { text: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30' },
  Myth: { text: 'text-amber-300', bg: 'bg-amber-300/10', border: 'border-amber-300/30' },
};

export function useDropFinderData(simcInput: string, activeSpecs: Set<string>) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(null);
  const [upgradeTracks, setUpgradeTracks] = useState<UpgradeTracks>({});
  const [selectedId, setSelectedId] = useState('');
  const [drops, setDrops] = useState<Record<string, DropItem[]> | null>(null);
  const [loading, setLoading] = useState(false);

  const className = useMemo(() => detectClass(simcInput), [simcInput]);
  const specName = useMemo(() => detectSpec(simcInput), [simcInput]);
  const specParam = useMemo(() => [...activeSpecs].sort().join(','), [activeSpecs]);

  useEffect(() => {
    fetch(`${API_URL}/api/season-config`)
      .then((r) => r.json())
      .then(setSeasonConfig)
      .catch(() => {});
    fetch(`${API_URL}/api/instances`)
      .then((r) => r.json())
      .then(setInstances)
      .catch(() => {});
    fetch(`${API_URL}/api/upgrade-tracks`)
      .then((r) => r.json())
      .then(setUpgradeTracks)
      .catch(() => {});
  }, []);

  const { raids, dungeonCats } = useMemo(() => {
    if (!seasonConfig)
      return {
        raids: [] as Instance[],
        dungeonCats: [] as { cat: DungeonCategory; instances: Instance[] }[],
      };

    const poolMap = new Map<number, Set<number>>();
    for (const cat of seasonConfig.dungeon_categories) {
      const meta = instances.find((i) => i.id === cat.poolInstanceId);
      if (meta) {
        poolMap.set(cat.poolInstanceId, new Set(meta.encounters.map((e) => e.id)));
      }
    }

    const raidList: Instance[] = [];
    const dcList: { cat: DungeonCategory; instances: Instance[] }[] =
      seasonConfig.dungeon_categories.map((cat) => ({ cat, instances: [] }));

    for (const inst of instances) {
      if (inst.type === 'raid' && inst.id > 0) {
        raidList.push(inst);
      } else if (inst.type === 'dungeon') {
        let placed = false;
        for (const dc of dcList) {
          const pool = poolMap.get(dc.cat.poolInstanceId);
          if (pool?.has(inst.id)) {
            dc.instances.push(inst);
            placed = true;
          }
        }
        if (!placed && dcList.length > 0) {
          dcList[dcList.length - 1].instances.push(inst);
        }
      }
    }
    raidList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const dc of dcList) {
      dc.instances.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { raids: raidList, dungeonCats: dcList };
  }, [instances, seasonConfig]);

  useEffect(() => {
    if (!selectedId) {
      setDrops(null);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (className) params.set('class_name', className);
    if (specParam) params.set('spec', specParam);
    const qs = params.toString();
    const url = selectedId.startsWith('type:')
      ? `${API_URL}/api/instances/type/${selectedId.slice(5)}/drops`
      : `${API_URL}/api/instances/${selectedId}/drops`;
    fetch(`${url}${qs ? `?${qs}` : ''}`)
      .then((r) => r.json())
      .then((data) => setDrops(data.detail ? null : data))
      .catch(() => setDrops(null))
      .finally(() => setLoading(false));
  }, [selectedId, className, specParam]);

  return {
    instances,
    seasonConfig,
    upgradeTracks,
    selectedId,
    setSelectedId,
    drops,
    loading,
    raids,
    dungeonCats,
    className,
    specName,
  };
}
