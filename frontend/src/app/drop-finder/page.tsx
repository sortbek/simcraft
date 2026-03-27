'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSimContext } from '../components/SimContext';
import { API_URL } from '../lib/api';
import { storeScenarioSiblings, clearScenarioSiblings } from '../lib/scenario-siblings';
import type { SeasonConfigResponse, DifficultyDef, DungeonCategory } from '../lib/types';

interface Instance {
  id: number;
  name: string;
  type: string;
  order?: number;
  encounters: { id: number; name: string }[];
}

interface TrackInfo {
  ilvl: number;
  bonus_id: number;
  quality: number;
  track?: string;
  level?: number;
  max_level?: number;
}

interface TrackLevel {
  level: number;
  max_level: number;
  ilvl: number;
  bonus_id: number;
  quality: number;
}

type UpgradeTracks = Record<string, TrackLevel[]>;

interface DropItem {
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  encounter: string;
  inventory_type?: number;
  bonus_ids?: number[];
  difficulty_info?: Record<string, TrackInfo>;
  dungeon_info?: Record<string, TrackInfo>;
}

const QUALITY_COLORS: Record<number, string> = {
  1: 'text-gray-400',
  2: 'text-green-400',
  3: 'text-blue-400',
  4: 'text-purple-400',
  5: 'text-orange-400',
  6: 'text-amber-300',
};

type Category = 'raids' | string; // "raids" or dungeon category keys like "mplus", "normal-dungeons"

function getTrackInfo(item: DropItem, raidDiff: string, dungeonDiff: string): TrackInfo | null {
  return item.dungeon_info?.[dungeonDiff] ?? item.difficulty_info?.[raidDiff] ?? null;
}

function resolveUpgrade(
  item: DropItem,
  raidDiff: string,
  dungeonDiff: string,
  upgradeLevel: number,
  tracks: UpgradeTracks
): { ilvl: number; bonus_id: number; quality: number } {
  const base = getTrackInfo(item, raidDiff, dungeonDiff);
  if (!base || !base.track || upgradeLevel <= 0) {
    return {
      ilvl: base?.ilvl ?? item.ilevel,
      bonus_id: base?.bonus_id ?? 0,
      quality: base?.quality ?? item.quality,
    };
  }
  const trackLevels = tracks[base.track];
  if (!trackLevels) return { ilvl: base.ilvl, bonus_id: base.bonus_id, quality: base.quality };
  const target = trackLevels.find((t) => t.level === upgradeLevel);
  if (!target) return { ilvl: base.ilvl, bonus_id: base.bonus_id, quality: base.quality };
  return { ilvl: target.ilvl, bonus_id: target.bonus_id, quality: target.quality };
}

function detectClass(simcInput: string): string | null {
  const m = simcInput.match(
    /^(warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|demon_hunter|demonhunter|druid|evoker)\s*=/m
  );
  return m ? m[1] : null;
}

function detectSpec(simcInput: string): string | null {
  const m = simcInput.match(/^spec=(\w+)/m);
  return m ? m[1] : null;
}

export default function DropFinderPage() {
  const {
    simcInput,
    fightStyle,
    threads,
    selectedTalent,
    targetCount,
    fightLength,
    customApl,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    scenarios,
    clearScenarios,
  } = useSimContext();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [drops, setDrops] = useState<Record<string, DropItem[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [difficulty, setDifficulty] = useState<string>('heroic');
  const [dungeonDiff, setDungeonDiff] = useState('mythic+10');
  const [upgradeTracks, setUpgradeTracks] = useState<UpgradeTracks>({});
  const [upgradeLevel, setUpgradeLevel] = useState<number>(0);

  const className = useMemo(() => detectClass(simcInput), [simcInput]);
  const specName = useMemo(() => detectSpec(simcInput), [simcInput]);
  const hasCharacter = simcInput.trim().length >= 10;

  // Load season config + instances + upgrade tracks
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

  // Determine available upgrade levels from the current difficulty's track
  const currentTrackInfo = useMemo(() => {
    if (!drops) return null;
    for (const items of Object.values(drops)) {
      for (const item of items) {
        const info = getTrackInfo(item, difficulty, dungeonDiff);
        if (info?.track && upgradeTracks[info.track]) {
          return {
            name: info.track,
            levels: upgradeTracks[info.track],
            baseLevel: info.level ?? 1,
          };
        }
      }
    }
    return null;
  }, [drops, difficulty, dungeonDiff, upgradeTracks]);

  // Categorize instances using season config
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

    const raids: Instance[] = [];
    const dungeonCats: { cat: DungeonCategory; instances: Instance[] }[] =
      seasonConfig.dungeon_categories.map((cat) => ({ cat, instances: [] }));

    for (const inst of instances) {
      if (inst.type === 'raid' && inst.id > 0) {
        raids.push(inst);
      } else if (inst.type === 'dungeon') {
        let placed = false;
        for (const dc of dungeonCats) {
          const pool = poolMap.get(dc.cat.poolInstanceId);
          if (pool?.has(inst.id)) {
            dc.instances.push(inst);
            placed = true;
            break;
          }
        }
        if (!placed && dungeonCats.length > 0) {
          // Default to first dungeon category
          dungeonCats[dungeonCats.length - 1].instances.push(inst);
        }
      }
    }
    raids.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const dc of dungeonCats) {
      dc.instances.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { raids, dungeonCats };
  }, [instances, seasonConfig]);

  // Load drops when instance selection changes
  useEffect(() => {
    if (!selectedId) {
      setDrops(null);
      setSelected(new Set());
      return;
    }
    setLoading(true);
    setSelected(new Set());
    const params = new URLSearchParams();
    if (className) params.set('class_name', className);
    if (specName) params.set('spec', specName);
    const qs = params.toString();
    const url = selectedId.startsWith('type:')
      ? `${API_URL}/api/instances/type/${selectedId.slice(5)}/drops`
      : `${API_URL}/api/instances/${selectedId}/drops`;
    fetch(`${url}${qs ? `?${qs}` : ''}`)
      .then((r) => r.json())
      .then((data) => {
        setDrops(data.detail ? null : data);
      })
      .catch(() => setDrops(null))
      .finally(() => setLoading(false));
  }, [selectedId, className, specName]);

  function toggleItem(itemId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }
  function selectAll() {
    if (!drops) return;
    const all = new Set<number>();
    for (const items of Object.values(drops)) for (const item of items) all.add(item.item_id);
    setSelected(all);
  }
  function selectNone() {
    setSelected(new Set());
  }

  async function handleSubmit() {
    if (!drops || selected.size === 0) return;
    setError('');
    setSubmitting(true);
    clearScenarioSiblings();
    try {
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

      const configs =
        scenarios.length > 0 ? scenarios : [{ id: '', fightStyle, targetCount, fightLength }];

      const batchId = scenarios.length > 0 ? crypto.randomUUID() : undefined;

      const sharedPayload = {
        simc_input: simcInput,
        drop_items: dropItems,
        iterations: 10000,
        target_error: 0.1,
        threads,
        ...(batchId ? { batch_id: batchId } : {}),
        ...(selectedTalent ? { talents: selectedTalent } : {}),
        ...(customApl ? { custom_apl: customApl } : {}),
        ...(simcHeader ? { simc_header: simcHeader } : {}),
        ...(simcBasePlayer ? { simc_base_player: simcBasePlayer } : {}),
        ...(simcRaidActors ? { simc_raid_actors: simcRaidActors } : {}),
        ...(simcPostCombos ? { simc_post_combos: simcPostCombos } : {}),
        ...(simcFooter ? { simc_footer: simcFooter } : {}),
      };

      const results = await Promise.allSettled(
        configs.map(async (config) => {
          const res = await fetch(`${API_URL}/api/droptimizer/sim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...sharedPayload,
              fight_style: config.fightStyle,
              desired_targets: config.targetCount,
              max_time: config.fightLength,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.detail || `Server error ${res.status}`);
          }
          return res.json();
        })
      );

      if (scenarios.length === 0) {
        const r = results[0];
        if (r.status === 'fulfilled') {
          window.location.href = `/sim/${r.value.id}`;
        } else {
          throw r.reason;
        }
      } else {
        const siblings = configs
          .map((config, i) => {
            const r = results[i];
            return r.status === 'fulfilled'
              ? {
                  id: r.value.id,
                  fightStyle: config.fightStyle,
                  targetCount: config.targetCount,
                  fightLength: config.fightLength,
                }
              : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        if (siblings.length > 0) {
          storeScenarioSiblings(siblings);
          clearScenarios();
          window.location.href = `/sim/${siblings[0].id}`;
        } else {
          throw new Error('All scenario submissions failed');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit sim');
    } finally {
      setSubmitting(false);
    }
  }

  const [category, setCategory] = useState<Category | ''>('');

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isDungeon = !!activeDungeonCat;
  const selectedInstance =
    selectedId && !selectedId.startsWith('type:')
      ? instances.find((i) => String(i.id) === selectedId)
      : null;
  const totalItems = drops ? Object.values(drops).reduce((n, items) => n + items.length, 0) : 0;

  // Get difficulty list for current category from season config
  const activeDifficulties: DifficultyDef[] = useMemo(() => {
    if (!seasonConfig) return [];
    if (isRaid) return seasonConfig.raid_difficulties;
    if (activeDungeonCat) return activeDungeonCat.cat.difficulties;
    return [];
  }, [seasonConfig, isRaid, activeDungeonCat]);

  // Category tabs: raids + all dungeon categories from season config
  const categoryTabs = useMemo(() => {
    const tabs: { key: string; label: string; icon: string }[] = [
      {
        key: 'raids',
        label: 'Raids',
        icon: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
      },
    ];
    for (const dc of dungeonCats) {
      const icon =
        dc.cat.key === 'mplus'
          ? 'M8 1v14M1 8h14M4 4l8 8M12 4l-8 8'
          : 'M2 2h12v12H2zM5 5h6M5 8h6M5 11h3';
      tabs.push({ key: dc.cat.key, label: dc.cat.label, icon });
    }
    return tabs;
  }, [dungeonCats]);

  return (
    <div className="space-y-6">
      {/* Category selector */}
      <div className="grid grid-cols-3 gap-3">
        {categoryTabs.map((cat) => (
          <button
            key={cat.key}
            onClick={() => {
              setCategory(cat.key);
              setSelectedId('');
              setDrops(null);
              setSelected(new Set());
            }}
            className={`card p-4 text-center transition-all ${category === cat.key ? 'border-gold/50 bg-gold/[0.03]' : 'hover:border-gold/20'}`}
          >
            <div
              className={`mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${category === cat.key ? 'bg-gold/20' : 'bg-gold/10'}`}
            >
              <svg
                className="h-5 w-5 text-gold"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={cat.icon} />
              </svg>
            </div>
            <p
              className={`text-[13px] font-semibold transition-colors ${category === cat.key ? 'text-gold' : 'text-white'}`}
            >
              {cat.label}
            </p>
          </button>
        ))}
      </div>

      {/* Instance buttons */}
      {category && (
        <div className="card p-5">
          <label className="label-text">{isRaid ? 'Select Raid' : 'Select Dungeon'}</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedId(isRaid ? 'type:raid' : 'type:dungeon')}
              className={`rounded-lg border px-4 py-2 text-[13px] font-medium transition-all ${
                selectedId === 'type:raid' || selectedId === 'type:dungeon'
                  ? 'border-white bg-white text-black'
                  : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
              }`}
            >
              All {isRaid ? 'Raids' : 'Dungeons'}
            </button>
            {(isRaid ? raids : (activeDungeonCat?.instances ?? [])).map((inst) => (
              <button
                key={inst.id}
                onClick={() => setSelectedId(String(inst.id))}
                className={`rounded-lg border px-4 py-2 text-[13px] font-medium transition-all ${
                  selectedId === String(inst.id)
                    ? 'border-white bg-white text-black'
                    : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                }`}
              >
                {inst.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Difficulty selector */}
      {(isRaid || isDungeon) && selectedId && activeDifficulties.length > 0 && (
        <div className="card p-5">
          <label className="label-text">Difficulty</label>
          <div className="flex flex-wrap gap-1.5">
            {activeDifficulties.map((d) => {
              const currentDiff = isRaid ? difficulty : dungeonDiff;
              return (
                <button
                  key={d.key}
                  onClick={() => {
                    if (isRaid) {
                      setDifficulty(d.key);
                    } else {
                      setDungeonDiff(d.key);
                    }
                    setUpgradeLevel(0);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all ${
                    currentDiff === d.key
                      ? 'border-white bg-white text-black'
                      : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Upgrade level selector */}
      {currentTrackInfo && drops && (
        <div className="card p-5">
          <label className="label-text">Upgrade Level</label>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setUpgradeLevel(0)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all ${
                upgradeLevel === 0
                  ? 'border-white bg-white text-black'
                  : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
              }`}
            >
              Base
            </button>
            {currentTrackInfo.levels.map((lvl) => (
              <button
                key={lvl.level}
                onClick={() => setUpgradeLevel(lvl.level)}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all ${
                  upgradeLevel === lvl.level
                    ? 'border-white bg-white text-black'
                    : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                }`}
              >
                {currentTrackInfo.name} {lvl.level}/{lvl.max_level}
                <span className="ml-1 text-[10px] opacity-60">{lvl.ilvl}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtering info */}
      {className ? (
        <p className="text-xs text-gold">
          Filtering for {specName || ''} {className.replace('_', ' ')}
        </p>
      ) : (
        <p className="text-xs text-muted">
          Paste a SimC export above to filter drops for your class.
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-8">
          <svg className="h-6 w-6 animate-spin text-gold" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path
              d="M14 8a6 6 0 00-6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}

      {/* No drops */}
      {!loading && selectedId && !drops && (
        <p className="py-6 text-center text-sm text-muted">
          No equippable drops found for this instance.
        </p>
      )}

      {/* Drops grouped by slot */}
      {!loading && drops && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              {selectedInstance?.name ||
                (selectedId.startsWith('type:') ? `All ${isRaid ? 'Raids' : 'Dungeons'}` : '')}{' '}
              &mdash; {totalItems} items
              {selected.size > 0 && (
                <span className="ml-1.5 text-gold">({selected.size} selected)</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-[11px] text-gray-500 transition-colors hover:text-white"
              >
                Select all
              </button>
              <button
                onClick={selectNone}
                className="text-[11px] text-gray-500 transition-colors hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>

          {Object.entries(drops).map(([slot, items]) => (
            <div key={slot} className="card p-4">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
                {slot}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-gray-600">
                  ({items.length})
                </span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {items.map((item) => {
                  const isSelected = selected.has(item.item_id);
                  const resolved = resolveUpgrade(
                    item,
                    difficulty,
                    dungeonDiff,
                    upgradeLevel,
                    upgradeTracks
                  );
                  const effectiveBonusId = getTrackInfo(item, difficulty, dungeonDiff)?.bonus_id;
                  return (
                    <button
                      key={item.item_id}
                      onClick={() => toggleItem(item.item_id)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all ${
                        isSelected
                          ? 'border-gold/40 bg-gold/10'
                          : 'border-border bg-surface-2 hover:border-gray-500'
                      }`}
                    >
                      <img
                        src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
                        alt=""
                        className="h-6 w-6 rounded"
                      />
                      <a
                        href={`https://www.wowhead.com/item=${item.item_id}`}
                        data-wowhead={`item=${item.item_id}${effectiveBonusId ? `&bonus=${effectiveBonusId}` : ''}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={`text-[12px] font-medium ${QUALITY_COLORS[resolved.quality] || 'text-gray-400'}`}
                      >
                        {item.name}
                      </a>
                      <span className="text-[11px] tabular-nums text-gray-600">
                        {resolved.ilvl}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

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
            ) : !hasCharacter ? (
              'Paste SimC export to simulate'
            ) : selected.size === 0 ? (
              'Select items to simulate'
            ) : scenarios.length > 0 ? (
              `Run ${scenarios.length} Scenario${scenarios.length > 1 ? 's' : ''} (${selected.size} items)`
            ) : (
              `Find Upgrades (${selected.size} items)`
            )}
          </button>

          {/* Sticky side button */}
          <button
            onClick={handleSubmit}
            disabled={submitting || selected.size === 0 || !hasCharacter}
            className="btn-primary group fixed right-4 top-1/2 z-[90] flex w-10 -translate-y-1/2 items-center gap-0 overflow-hidden rounded-full px-2.5 py-2.5 text-sm shadow-lg shadow-black/50 transition-all duration-200 hover:w-auto hover:gap-2 hover:rounded-xl hover:px-4"
          >
            {submitting ? (
              <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path
                  d="M14 8a6 6 0 00-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2l10 6-10 6V2z" />
              </svg>
            )}
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:opacity-100">
              {submitting
                ? 'Starting sim…'
                : scenarios.length > 0
                  ? `Run ${scenarios.length} Scenarios`
                  : `Find Upgrades (${selected.size})`}
            </span>
          </button>
        </div>
      )}

      {/* Empty state */}
      {!selectedId && !loading && !category && (
        <p className="py-6 text-center text-sm text-muted">Select a category to get started.</p>
      )}
    </div>
  );
}
