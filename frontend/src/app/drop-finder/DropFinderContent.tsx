'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import ToggleButtonGroup from '../components/ui/ToggleButtonGroup';
import { API_URL } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import type {
  SeasonConfigResponse,
  DifficultyDef,
  DifficultyGroup,
  DungeonCategory,
} from '../lib/types';
import ItemTable from '../components/loot/ItemTable';
import DungeonDrawer from '../components/loot/DungeonDrawer';
import DifficultySelect from '../components/loot/DifficultySelect';
import UpgradeSelect from '../components/loot/UpgradeSelect';
import CategorySelector from '../components/loot/CategorySelector';
import TalentPicker from '../components/talents/TalentPicker';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import { useLanguage } from '../lib/i18n';
import {
  detectClass,
  detectSpec,
  formatSpecName,
  getClassSpecs,
  getTrackInfo,
  resolveUpgrade,
  type DropItem,
  type DropItemPayload,
  type Instance,
  type UpgradeTracks,
} from '../components/loot/types';
import { parseEquippedGear, type EquippedGear } from '../lib/inheritedGear';

const SLOT_ORDER = [
  'Main Hand',
  'Off Hand',
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger',
  'Trinket',
];

const TRACK_SHORT: Record<string, string> = {
  Adventurer: 'Adv',
  Veteran: 'Vet',
  Champion: 'Champ',
  Hero: 'Hero',
  Myth: 'Myth',
};

const TRACK_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Adventurer: { text: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30' },
  Veteran: { text: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
  Champion: { text: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30' },
  Hero: { text: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30' },
  Myth: { text: 'text-amber-300', bg: 'bg-amber-300/10', border: 'border-amber-300/30' },
};

// --- Data loading hook ---

function useDropFinderData(simcInput: string, activeSpecs: Set<string>) {
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

// --- Content ---

export default function DropFinderContent() {
  const { t } = useLanguage();
  const { simcInput, hasInput } = useSimContext();
  const [category, setCategory] = useState('mplus');

  // Spec selection: main spec on by default, off-specs toggleable
  const detectedClass = useMemo(() => detectClass(simcInput), [simcInput]);
  const detectedSpec = useMemo(() => detectSpec(simcInput), [simcInput]);
  const allSpecs = useMemo(
    () => (detectedClass ? getClassSpecs(detectedClass) : []),
    [detectedClass]
  );
  const [activeSpecs, setActiveSpecs] = useState<Set<string>>(new Set());
  const [prevSpec, setPrevSpec] = useState<string | null>(null);

  if (detectedSpec !== prevSpec) {
    setPrevSpec(detectedSpec);
    setActiveSpecs(detectedSpec ? new Set([detectedSpec]) : new Set());
  }

  function toggleSpec(spec: string) {
    setActiveSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(spec)) {
        if (next.size <= 1) return prev;
        next.delete(spec);
      } else {
        next.add(spec);
      }
      return next;
    });
  }

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
  } = useDropFinderData(simcInput, activeSpecs);

  // Count equipped embellished items
  const equippedEmbellishments = useMemo(() => {
    if (!simcInput) return 0;
    let count = 0;
    for (const line of simcInput.split('\n')) {
      if (line.startsWith('#') || !line.includes('bonus_id=')) continue;
      const match = line.match(/bonus_id=([0-9/:]+)/);
      if (match) {
        const ids = match[1].split(/[/:]/).map(Number);
        if (ids.includes(8960)) count++;
      }
    }
    return count;
  }, [simcInput]);

  const equippedGear: EquippedGear = useMemo(() => parseEquippedGear(simcInput), [simcInput]);

  const hasCharacter = hasInput;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [difficulty, setDifficulty] = useState('heroic');
  const [dungeonDiff, setDungeonDiff] = useState('mythic+10');
  const [upgradeLevel, setUpgradeLevel] = useState(0);
  // Instance pool: set of instance IDs that are "checked" (multi-select)
  const [dungeonPool, setDungeonPool] = useState<Set<string>>(new Set());
  const [raidPool, setRaidPool] = useState<Set<string>>(new Set());
  const [excludedSlots, setExcludedSlots] = useState<Set<string>>(new Set());
  const [slotFilterOpen, setSlotFilterOpen] = useState(false);
  const previousExcludedSlotsRef = useRef<Set<string>>(new Set());
  const slotFilterRef = useRef<HTMLDetailsElement | null>(null);

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isDungeon = !!activeDungeonCat;
  const isCrafted = activeDungeonCat?.cat.key === 'crafted';
  const isPoolOnly = isDungeon && (activeDungeonCat?.instances.length ?? 0) === 0;
  const selectedInstance =
    selectedId && !selectedId.startsWith('type:')
      ? instances.find((i) => String(i.id) === selectedId)
      : null;

  const dungeonInstances = useMemo(() => activeDungeonCat?.instances ?? [], [activeDungeonCat]);

  // Auto-select M+ pool and initialize dungeon pool on category change
  useEffect(() => {
    if (category === 'raids') {
      setSelectedId('type:raid');
      setRaidPool(new Set(raids.map((i) => String(i.id))));
    } else if (activeDungeonCat) {
      setSelectedId(String(activeDungeonCat.cat.poolInstanceId));
      setDungeonDiff(activeDungeonCat.cat.defaultDifficulty);
      const allDiffs = activeDungeonCat.cat.difficultyGroups
        ? activeDungeonCat.cat.difficultyGroups.flatMap((g) => g.difficulties)
        : activeDungeonCat.cat.difficulties;
      const defaultDiff = allDiffs.find((d) => d.key === activeDungeonCat.cat.defaultDifficulty);
      setUpgradeLevel(defaultDiff?.level ?? 0);
      // Select all dungeons by default
      setDungeonPool(new Set(dungeonInstances.map((i) => String(i.id))));
    } else {
      setSelectedId('');
    }
  }, [category, activeDungeonCat, dungeonInstances, raids, setSelectedId]);

  // Select all items whenever drops change
  useEffect(() => {
    if (!drops) {
      setSelected(new Set());
      return;
    }
    const all = new Set<number>();
    for (const items of Object.values(drops)) for (const item of items) all.add(item.item_id);
    setSelected(all);
  }, [drops]);

  // Prune selection when instance pool filter changes
  useEffect(() => {
    if (!drops || isPoolOnly) return;
    const pool = isRaid ? raidPool : dungeonPool;
    const instanceList = isRaid ? raids : dungeonInstances;
    const selectedNames = new Set(
      instanceList.filter((i) => pool.has(String(i.id))).map((i) => i.name)
    );
    if (selectedNames.size === instanceList.length) return;
    const available = new Set<number>();
    for (const items of Object.values(drops)) {
      for (const item of items) {
        if (!item.instance_name || selectedNames.has(item.instance_name)) {
          available.add(item.item_id);
        }
      }
    }
    setSelected((prev) => {
      const pruned = new Set<number>();
      for (const id of prev) {
        if (available.has(id)) pruned.add(id);
      }
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [drops, dungeonPool, raidPool, dungeonInstances, raids, isRaid, isPoolOnly]);

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
    if (activeDungeonCat) {
      if (activeDungeonCat.cat.difficultyGroups) {
        return activeDungeonCat.cat.difficultyGroups.flatMap((g) => g.difficulties);
      }
      return activeDungeonCat.cat.difficulties;
    }
    return [];
  }, [seasonConfig, isRaid, activeDungeonCat]);

  const activeDifficultyGroups: DifficultyGroup[] | null = useMemo(() => {
    if (activeDungeonCat?.cat.difficultyGroups) return activeDungeonCat.cat.difficultyGroups;
    return null;
  }, [activeDungeonCat]);

  const allKey = isRaid
    ? 'type:raid'
    : String(activeDungeonCat?.cat.poolInstanceId ?? 'type:dungeon');

  // Resolve current difficulty info for the summary
  const currentDiff = isRaid ? difficulty : dungeonDiff;
  const selectedDiffDef = activeDifficulties.find((d) => d.key === currentDiff);
  const selectedDiffInfo = useMemo(() => {
    if (!selectedDiffDef) return null;
    const trackLevels = selectedDiffDef.track ? upgradeTracks[selectedDiffDef.track] : null;
    const max = trackLevels?.at(-1)?.max_level ?? selectedDiffDef.level;
    const ilvl =
      trackLevels?.find((t) => t.level === selectedDiffDef.level)?.ilvl ??
      selectedDiffDef.fixedIlvl;
    const tc = selectedDiffDef.track ? TRACK_COLORS[selectedDiffDef.track] : null;
    return { ilvl, max, tc, track: selectedDiffDef.track, level: selectedDiffDef.level };
  }, [selectedDiffDef, upgradeTracks]);

  // Filter drops by instance pool (dungeons or raids)
  const filteredDrops = useMemo(() => {
    if (!drops) return null;
    if (isPoolOnly) return drops;

    const pool = isRaid ? raidPool : dungeonPool;
    const instanceList = isRaid ? raids : dungeonInstances;
    if (pool.size === 0) return {};
    const selectedNames = new Set(
      instanceList.filter((i) => pool.has(String(i.id))).map((i) => i.name)
    );
    if (selectedNames.size === instanceList.length) return drops; // all selected = no filter
    const filtered: Record<string, DropItem[]> = {};
    for (const [slot, items] of Object.entries(drops)) {
      const kept = items.filter(
        (item) => !item.instance_name || selectedNames.has(item.instance_name)
      );
      if (kept.length > 0) filtered[slot] = kept;
    }
    return filtered;
  }, [drops, dungeonPool, raidPool, dungeonInstances, raids, isRaid, isPoolOnly]);

  const upgradeLevelOptions = useMemo(() => {
    if (!currentTrackInfo) return [];
    return [
      { key: 0, label: t('dropFinder.base') },
      ...currentTrackInfo.levels.map((lvl) => ({
        key: lvl.level,
        label: `${currentTrackInfo.name} ${lvl.level}/${lvl.max_level}`,
        sublabel: String(lvl.ilvl),
      })),
    ];
  }, [currentTrackInfo, t]);

  const availableSlots = useMemo(() => {
    if (!filteredDrops) return [];
    return Object.keys(filteredDrops).sort((a, b) => {
      const ai = SLOT_ORDER.indexOf(a);
      const bi = SLOT_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [filteredDrops]);

  const visibleDrops = useMemo(() => {
    if (!filteredDrops) return null;
    if (excludedSlots.size === 0) return filteredDrops;

    const filtered: Record<string, DropItem[]> = {};
    for (const [slot, items] of Object.entries(filteredDrops)) {
      if (!excludedSlots.has(slot)) filtered[slot] = items;
    }
    return filtered;
  }, [filteredDrops, excludedSlots]);

  const slotFilterSummary = useMemo(() => {
    if (availableSlots.length === 0 || excludedSlots.size === 0) return 'All slots';
    const visibleCount = availableSlots.filter((slot) => !excludedSlots.has(slot)).length;
    if (visibleCount <= 0) return 'No slots';
    if (visibleCount === 1) {
      return availableSlots.find((slot) => !excludedSlots.has(slot)) ?? '1 slot';
    }
    return `${visibleCount} slots`;
  }, [availableSlots, excludedSlots]);

  function selectItems(itemIds: number[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const itemId of itemIds) next.add(itemId);
      return next;
    });
  }

  function clearItems(itemIds: number[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const itemId of itemIds) next.delete(itemId);
      return next;
    });
  }

  function toggleSlot(slot: string) {
    setExcludedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }

  function resetExcludedSlots() {
    setExcludedSlots(new Set());
  }

  const headerLabel =
    selectedInstance?.name ||
    (selectedId.startsWith('type:') ? (isRaid ? t('loot.allRaids') : t('loot.allDungeons')) : '');

  // Dungeon pool summary for context
  const dungeonPoolLabel = useMemo(() => {
    if (isRaid) return isRaid ? t('loot.allRaids') : '';
    const total = dungeonInstances.length;
    const checked = dungeonInstances.filter((i) => dungeonPool.has(String(i.id))).length;
    if (checked === total) return t('loot.allDungeons');
    if (checked === 1) {
      const sel = dungeonInstances.find((i) => dungeonPool.has(String(i.id)));
      return sel?.name ?? `${checked} dungeons`;
    }
    return `${checked} dungeons`;
  }, [isRaid, dungeonInstances, dungeonPool, t]);

  useEffect(() => {
    if (!filteredDrops) return;
    if (excludedSlots.size === 0) return;

    const available = new Set<number>();
    for (const [slot, items] of Object.entries(filteredDrops)) {
      if (excludedSlots.has(slot)) continue;
      for (const item of items) available.add(item.item_id);
    }

    setSelected((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (available.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [filteredDrops, excludedSlots]);

  useEffect(() => {
    if (!filteredDrops) return;

    const previousExcluded = previousExcludedSlotsRef.current;
    const reenabledSlots = [...previousExcluded].filter((slot) => !excludedSlots.has(slot));
    previousExcludedSlotsRef.current = new Set(excludedSlots);

    if (reenabledSlots.length === 0) return;

    setSelected((prev) => {
      const next = new Set(prev);
      let changed = false;

      for (const slot of reenabledSlots) {
        for (const item of filteredDrops[slot] ?? []) {
          if (!next.has(item.item_id)) {
            next.add(item.item_id);
            changed = true;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [filteredDrops, excludedSlots]);

  useEffect(() => {
    if (!slotFilterOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (slotFilterRef.current?.contains(target)) return;
      setSlotFilterOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [slotFilterOpen]);

  // Sim submission
  const buildPayload = useCallback(() => {
    if (!visibleDrops || selected.size === 0) return null;
    const dropItems: DropItemPayload[] = [];
    for (const items of Object.values(visibleDrops)) {
      for (const item of items) {
        if (selected.has(item.item_id)) {
          const resolved = resolveUpgrade(
            item,
            difficulty,
            dungeonDiff,
            upgradeLevel,
            upgradeTracks
          );
          // No `slot_inherits` in the submission payload — the backend
          // derives enchant/gem inheritance from the equipped profile so
          // the frontend isn't computing simulation semantics.
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
  }, [visibleDrops, selected, simcInput, difficulty, dungeonDiff, upgradeLevel, upgradeTracks]);

  const validate = useCallback(() => {
    if (!visibleDrops || selected.size === 0) return t('validation.selectItems');
    return null;
  }, [visibleDrops, selected, t]);

  const {
    submit: handleSubmit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({ endpoint: '/api/droptimizer/sim', buildPayload, validate });

  const submitLabel = !hasCharacter
    ? t('validation.pasteSimcDropFinder')
    : selected.size === 0
      ? t('validation.selectItemsDropFinder')
      : buttonLabel(t('button.findUpgrades', { count: selected.size }));

  return (
    <div className="space-y-4 pb-20">
      {/* Page header */}
      <div>
        <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
          Drop Finder
        </h1>
        <p className="max-w-2xl text-sm text-on-surface-variant">
          Find and simulate the best gear drops from across Azeroth. Refine your search by activity
          type and difficulty.
        </p>
      </div>

      <TalentPicker />

      <CategorySelector category={category} onChange={setCategory} dungeonCats={dungeonCats} />

      {/* Configuration card: dungeon pool + difficulty + upgrade level */}
      {(isRaid || isDungeon) && (
        <div className="card space-y-4 p-5">
          {/* Instance pool drawer */}
          {isDungeon && !isPoolOnly && dungeonInstances.length > 0 && (
            <div>
              <label className="label-text">{t('dropFinder.dungeonPool') ?? 'Dungeon pool'}</label>
              <DungeonDrawer
                instances={dungeonInstances}
                allKey={allKey}
                allLabel={t('loot.allDungeons')}
                selectedIds={dungeonPool}
                onChange={setDungeonPool}
              />
            </div>
          )}
          {isRaid && raids.length > 0 && (
            <div>
              <label className="label-text">{t('dropFinder.selectRaid')}</label>
              <DungeonDrawer
                instances={raids}
                allKey="type:raid"
                allLabel={t('loot.allRaids')}
                selectedIds={raidPool}
                onChange={setRaidPool}
              />
            </div>
          )}

          {/* Difficulty + upgrade level */}
          {activeDifficulties.length > 0 && (
            <div
              className={`grid gap-4 ${currentTrackInfo && drops ? 'grid-cols-1 sm:grid-cols-2' : ''}`}
            >
              <div>
                <label className="label-text">{t('dropFinder.difficulty')}</label>
                <DifficultySelect
                  value={isRaid ? difficulty : dungeonDiff}
                  onChange={(key, level) => {
                    if (isRaid) {
                      setDifficulty(key);
                      setUpgradeLevel(0);
                    } else {
                      setDungeonDiff(key);
                      setUpgradeLevel(level);
                    }
                  }}
                  difficulties={activeDifficulties}
                  difficultyGroups={activeDifficultyGroups}
                  upgradeTracks={upgradeTracks}
                  isCrafted={isCrafted}
                />
              </div>

              {currentTrackInfo && drops && (
                <div>
                  <label className="label-text">{t('dropFinder.upgradeLevel')}</label>
                  <UpgradeSelect
                    value={upgradeLevel}
                    onChange={setUpgradeLevel}
                    options={upgradeLevelOptions}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Spec filter */}
      <div className="flex flex-wrap items-center gap-2">
        {className ? (
          <>
            <p className="text-xs text-on-surface-variant">
              {t('dropFinder.showingLoot', { class: className.replace('_', ' ') })}
            </p>
            {allSpecs.length > 1 && (
              <>
                <span className="h-3.5 w-px bg-outline-variant/20" />
                <div className="flex flex-wrap gap-1">
                  {allSpecs.map((spec) => {
                    const isActive = activeSpecs.has(spec);
                    const isMain = spec === detectedSpec;
                    return (
                      <button
                        key={spec}
                        onClick={() => toggleSpec(spec)}
                        className={`rounded-md px-2 py-0.5 text-[13px] font-medium transition-all duration-150 ${
                          isActive
                            ? 'bg-gold/[0.08] text-gold'
                            : 'bg-surface-container-high text-on-surface-variant/40 hover:bg-surface-container-highest hover:text-on-surface-variant'
                        }`}
                      >
                        {formatSpecName(spec)}
                        {isMain && (
                          <span className="ml-1 text-[11px] opacity-50">
                            {t('dropFinder.mainSpec')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <p className="text-xs text-muted">{t('dropFinder.pasteExport')}</p>
        )}

        {availableSlots.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="h-3.5 w-px bg-outline-variant/20" />
            <details
              ref={slotFilterRef}
              className="relative"
              open={slotFilterOpen}
              onToggle={(e) => setSlotFilterOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary
                className={`flex cursor-pointer list-none items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-150 [&::-webkit-details-marker]:hidden ${
                  slotFilterOpen || excludedSlots.size > 0
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : 'border-transparent bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                }`}
              >
                <span className="font-semibold">Slots</span>
                <span className={slotFilterOpen || excludedSlots.size > 0 ? 'text-gold/90' : ''}>
                  {slotFilterSummary}
                </span>
                {excludedSlots.size > 0 && (
                  <span className="rounded-full border border-gold/20 bg-black/10 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                    {excludedSlots.size} hidden
                  </span>
                )}
                <svg
                  className={`h-3 w-3 transition-transform ${slotFilterOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 4.5L6 8l3.5-3.5" />
                </svg>
              </summary>
              <div className="absolute right-0 top-full z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-outline-variant/15 bg-surface-container p-3 shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 pb-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">
                      Slot Filter
                    </p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Disable slots you want to leave out of the current sim.
                    </p>
                  </div>
                  {excludedSlots.size > 0 && (
                    <button
                      type="button"
                      onClick={resetExcludedSlots}
                      className="rounded-lg border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant transition-colors hover:border-outline-variant/35 hover:text-on-surface"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {availableSlots.map((slot) => {
                    const isEnabled = !excludedSlots.has(slot);
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => toggleSlot(slot)}
                        aria-pressed={isEnabled}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                          isEnabled
                            ? 'border-gold/20 bg-gold/[0.08] text-on-surface hover:border-gold/35 hover:bg-gold/[0.12]'
                            : 'border-outline-variant/10 bg-surface-container-high text-on-surface-variant/45 hover:border-outline-variant/25 hover:text-on-surface-variant/70'
                        }`}
                      >
                        <span className={isEnabled ? '' : 'line-through'}>{slot}</span>
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${isEnabled ? 'bg-gold' : 'bg-outline-variant/30'}`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>
          </div>
        )}
      </div>

      {loading && <Spinner />}

      {!loading && selectedId && !visibleDrops && (
        <p className="py-6 text-center text-sm text-muted">{t('dropFinder.noDrops')}</p>
      )}

      {!loading && visibleDrops && (
        <>
          <ItemTable
            drops={visibleDrops}
            selected={selected}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectItems={selectItems}
            onClearItems={clearItems}
            difficulty={difficulty}
            dungeonDiff={dungeonDiff}
            upgradeLevel={upgradeLevel}
            upgradeTracks={upgradeTracks}
            headerLabel={headerLabel}
            equippedEmbellishments={equippedEmbellishments}
            equippedGear={equippedGear}
            spec={specName ?? ''}
          />

          <SimcDownloadBanner />
          <ErrorAlert message={error} />
        </>
      )}

      <ConfigFooter
        onSubmit={handleSubmit}
        submitting={submitting}
        buttonLabel={submitLabel}
        disabled={selected.size === 0 || !hasCharacter}
      />
    </div>
  );
}
