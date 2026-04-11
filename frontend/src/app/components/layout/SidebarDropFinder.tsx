'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '../../lib/api';
import type { SeasonConfigResponse, DungeonCategory } from '../../lib/types';
import type { Instance } from '../loot/types';
import { useLanguage } from '../../lib/i18n';

const PVP_KEYS = new Set(['pvp-conquest', 'pvp-honor', 'pvp-bloody-tokens', 'pvp-profession']);
const PROFESSION_KEYS = new Set(['crafted', 'rare-profession']);

interface SourceItem {
  key: string;
  label: string;
  instances: { id: number; name: string }[];
}

export default function SidebarDropFinder() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const activeSource = searchParams.get('source') ?? '';
  const activeInstance = searchParams.get('instance') ?? '';

  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/api/season-config`)
      .then((r) => r.json())
      .then(setSeasonConfig)
      .catch(() => {});
    fetch(`${API_URL}/api/instances`)
      .then((r) => r.json())
      .then(setInstances)
      .catch(() => {});
  }, []);

  const sources = useMemo(() => {
    if (!seasonConfig) return [];

    const poolMap = new Map<number, Set<number>>();
    for (const cat of seasonConfig.dungeon_categories) {
      const meta = instances.find((i) => i.id === cat.poolInstanceId);
      if (meta) {
        poolMap.set(cat.poolInstanceId, new Set(meta.encounters.map((e) => e.id)));
      }
    }

    // Build instance lists per category
    const catInstances = new Map<string, { id: number; name: string }[]>();
    for (const cat of seasonConfig.dungeon_categories) {
      catInstances.set(cat.key, []);
    }

    // Raids
    const raidInstances: { id: number; name: string }[] = [];
    for (const inst of instances) {
      if (inst.type === 'raid' && inst.id > 0) {
        raidInstances.push({ id: inst.id, name: inst.name });
      } else if (inst.type === 'dungeon') {
        for (const cat of seasonConfig.dungeon_categories) {
          const pool = poolMap.get(cat.poolInstanceId);
          if (pool?.has(inst.id)) {
            catInstances.get(cat.key)!.push({ id: inst.id, name: inst.name });
            break;
          }
        }
      }
    }
    raidInstances.sort((a, b) => {
      const ai = instances.find((i) => i.id === a.id);
      const bi = instances.find((i) => i.id === b.id);
      return (ai?.order ?? 0) - (bi?.order ?? 0);
    });
    for (const list of catInstances.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    const result: SourceItem[] = [
      { key: 'raids', label: t('loot.raids'), instances: raidInstances },
    ];

    const pvpInstances: { id: number; name: string }[] = [];
    const profInstances: { id: number; name: string }[] = [];

    for (const cat of seasonConfig.dungeon_categories) {
      const insts = catInstances.get(cat.key) ?? [];
      if (PVP_KEYS.has(cat.key)) {
        // PVP categories are pool-only, no sub-instances to show
        pvpInstances;
      } else if (PROFESSION_KEYS.has(cat.key)) {
        profInstances;
      } else {
        result.push({ key: cat.key, label: cat.label, instances: insts });
      }
    }

    result.push({ key: 'professions', label: 'Professions', instances: profInstances });
    result.push({ key: 'pvp', label: 'PVP', instances: pvpInstances });

    return result;
  }, [seasonConfig, instances, t]);

  return (
    <>
      {sources.map((source) => {
        const isActive = activeSource === source.key;
        const hasInstances = source.instances.length > 0;

        return (
          <div key={source.key}>
            <Link
              href={`/drop-finder?source=${source.key}`}
              className={`flex items-center gap-3 pl-4 pr-6 py-2 font-headline font-bold text-[10px] uppercase transition-all ${
                isActive
                  ? 'text-primary'
                  : 'text-on-surface-variant/60 hover:text-primary'
              }`}
            >
              {source.label}
            </Link>

            {isActive && hasInstances && (
              <div className="ml-4 border-l border-outline-variant/10 space-y-0.5">
                {source.instances.map((inst) => {
                  const instActive = activeInstance === String(inst.id);
                  return (
                    <Link
                      key={inst.id}
                      href={`/drop-finder?source=${source.key}&instance=${inst.id}`}
                      className={`block truncate pl-3 pr-6 py-1 text-[9px] font-medium transition-all ${
                        instActive
                          ? 'text-gold'
                          : 'text-on-surface-variant/40 hover:text-on-surface-variant'
                      }`}
                    >
                      {inst.name}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
