'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import FloatingSubmitButton from '../components/FloatingSubmitButton';
import { useSimContext } from '../components/SimContext';
import ToggleButtonGroup from '../components/ToggleButtonGroup';
import { API_URL } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import type { SeasonConfigResponse, DifficultyDef, DungeonCategory } from '../lib/types';
import CategorySelector from './CategorySelector';
import DropSlotList from './DropSlotList';
import {
  detectClass,
  detectSpec,
  getTrackInfo,
  resolveUpgrade,
  type DropItem,
  type Instance,
  type UpgradeTracks,
} from './types';

type Category = 'raids' | string;

// --- Data loading hook ---

function useDropFinderData(simcInput: string) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(null);
  const [upgradeTracks, setUpgradeTracks] = useState<UpgradeTracks>({});
  const [selectedId, setSelectedId] = useState('');
  const [drops, setDrops] = useState<Record<string, DropItem[]> | null>(null);
  const [loading, setLoading] = useState(false);

  const className = useMemo(() => detectClass(simcInput), [simcInput]);
  const specName = useMemo(() => detectSpec(simcInput), [simcInput]);

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
            break;
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
    if (specName) params.set('spec', specName);
    const qs = params.toString();
    const url = selectedId.startsWith('type:')
      ? `${API_URL}/api/instances/type/${selectedId.slice(5)}/drops`
      : `${API_URL}/api/instances/${selectedId}/drops`;
    fetch(`${url}${qs ? `?${qs}` : ''}`)
      .then((r) => r.json())
      .then((data) => setDrops(data.detail ? null : data))
      .catch(() => setDrops(null))
      .finally(() => setLoading(false));
  }, [selectedId, className, specName]);

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

// --- Spinner ---

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <svg className="h-6 w-6 animate-spin text-gold" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// --- Page ---

export default function DropFinderPage() {
  const { simcInput } = useSimContext();
  const {
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
  } = useDropFinderData(simcInput);

  const hasCharacter = simcInput.trim().length >= 10;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [difficulty, setDifficulty] = useState('heroic');
  const [dungeonDiff, setDungeonDiff] = useState('mythic+10');
  const [upgradeLevel, setUpgradeLevel] = useState(0);
  const [category, setCategory] = useState<Category | ''>('');

  useEffect(() => {
    setSelected(new Set());
  }, [drops]);

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isDungeon = !!activeDungeonCat;
  const selectedInstance =
    selectedId && !selectedId.startsWith('type:')
      ? instances.find((i) => String(i.id) === selectedId)
      : null;

  const currentTrackInfo = useMemo(() => {
    if (!drops) return null;
    for (const items of Object.values(drops)) {
      for (const item of items) {
        const info = getTrackInfo(item, difficulty, dungeonDiff);
        if (info?.track && upgradeTracks[info.track]) {
          return { name: info.track, levels: upgradeTracks[info.track] };
        }
      }
    }
    return null;
  }, [drops, difficulty, dungeonDiff, upgradeTracks]);

  const activeDifficulties: DifficultyDef[] = useMemo(() => {
    if (!seasonConfig) return [];
    if (isRaid) return seasonConfig.raid_difficulties;
    if (activeDungeonCat) return activeDungeonCat.cat.difficulties;
    return [];
  }, [seasonConfig, isRaid, activeDungeonCat]);

  const instanceOptions = useMemo(() => {
    const list = isRaid ? raids : (activeDungeonCat?.instances ?? []);
    const allKey = isRaid ? 'type:raid' : 'type:dungeon';
    return [
      { key: allKey, label: `All ${isRaid ? 'Raids' : 'Dungeons'}` },
      ...list.map((inst) => ({ key: String(inst.id), label: inst.name })),
    ];
  }, [isRaid, raids, activeDungeonCat]);

  const upgradeLevelOptions = useMemo(() => {
    if (!currentTrackInfo) return [];
    return [
      { key: 0, label: 'Base' },
      ...currentTrackInfo.levels.map((lvl) => ({
        key: lvl.level,
        label: `${currentTrackInfo.name} ${lvl.level}/${lvl.max_level}`,
        sublabel: String(lvl.ilvl),
      })),
    ];
  }, [currentTrackInfo]);

  function selectAll() {
    if (!drops) return;
    const all = new Set<number>();
    for (const items of Object.values(drops)) for (const item of items) all.add(item.item_id);
    setSelected(all);
  }

  const headerLabel =
    selectedInstance?.name ||
    (selectedId.startsWith('type:') ? `All ${isRaid ? 'Raids' : 'Dungeons'}` : '');

  // Sim submission
  const buildPayload = useCallback(() => {
    if (!drops || selected.size === 0) return null;
    const dropItems: DropItem[] = [];
    for (const items of Object.values(drops)) {
      for (const item of items) {
        if (selected.has(item.item_id)) {
          const resolved = resolveUpgrade(
            item,
            difficulty,
            dungeonDiff,
            upgradeLevel,
            upgradeTracks
          );
          dropItems.push({
            ...item,
            ilevel: resolved.ilvl,
            quality: resolved.quality,
            bonus_ids: resolved.bonus_id ? [resolved.bonus_id] : [],
          });
        }
      }
    }
    return { simc_input: simcInput, drop_items: dropItems };
  }, [drops, selected, simcInput, difficulty, dungeonDiff, upgradeLevel, upgradeTracks]);

  const validate = useCallback(() => {
    if (!drops || selected.size === 0) return 'Select at least one item to sim.';
    return null;
  }, [drops, selected]);

  const {
    submit: handleSubmit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({ endpoint: '/api/droptimizer/sim', buildPayload, validate });

  const submitLabel = !hasCharacter
    ? 'Paste SimC export to simulate'
    : selected.size === 0
      ? 'Select items to simulate'
      : buttonLabel(`Find Upgrades (${selected.size} items)`);

  return (
    <div className="space-y-6">
      <CategorySelector
        category={category}
        onChange={(key) => {
          setCategory(key);
          setSelectedId('');
        }}
        dungeonCats={dungeonCats}
      />

      {category && (
        <div className="card p-5">
          <label className="label-text">{isRaid ? 'Select Raid' : 'Select Dungeon'}</label>
          <ToggleButtonGroup
            value={selectedId}
            onChange={setSelectedId}
            options={instanceOptions}
          />
        </div>
      )}

      {(isRaid || isDungeon) && selectedId && activeDifficulties.length > 0 && (
        <div className="card p-5">
          <label className="label-text">Difficulty</label>
          <ToggleButtonGroup
            value={isRaid ? difficulty : dungeonDiff}
            onChange={(key) => {
              if (isRaid) setDifficulty(key);
              else setDungeonDiff(key);
              setUpgradeLevel(0);
            }}
            options={activeDifficulties.map((d) => ({ key: d.key, label: d.label }))}
            size="sm"
          />
        </div>
      )}

      {currentTrackInfo && drops && (
        <div className="card p-5">
          <label className="label-text">Upgrade Level</label>
          <ToggleButtonGroup
            value={upgradeLevel}
            onChange={setUpgradeLevel}
            options={upgradeLevelOptions}
            size="sm"
          />
        </div>
      )}

      {className ? (
        <p className="text-xs text-gold">
          Filtering for {specName || ''} {className.replace('_', ' ')}
        </p>
      ) : (
        <p className="text-xs text-muted">
          Paste a SimC export above to filter drops for your class.
        </p>
      )}

      {loading && <Spinner />}

      {!loading && selectedId && !drops && (
        <p className="py-6 text-center text-sm text-muted">
          No equippable drops found for this instance.
        </p>
      )}

      {!loading && drops && (
        <>
          <DropSlotList
            drops={drops}
            selected={selected}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectAll={selectAll}
            onClear={() => setSelected(new Set())}
            difficulty={difficulty}
            dungeonDiff={dungeonDiff}
            upgradeLevel={upgradeLevel}
            upgradeTracks={upgradeTracks}
            headerLabel={headerLabel}
          />

          <ErrorAlert message={error} />

          <button
            onClick={handleSubmit}
            disabled={submitting || selected.size === 0 || !hasCharacter}
            className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"
          >
            {submitting ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    opacity="0.25"
                  />
                  <path
                    d="M14 8a6 6 0 00-6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                Starting sim…
              </>
            ) : (
              submitLabel
            )}
          </button>

          <FloatingSubmitButton
            onClick={handleSubmit}
            disabled={selected.size === 0 || !hasCharacter}
            submitting={submitting}
            label={buttonLabel(`Find Upgrades (${selected.size})`)}
          />
        </>
      )}

      {!selectedId && !loading && !category && (
        <p className="py-6 text-center text-sm text-muted">Select a category to get started.</p>
      )}
    </div>
  );
}
