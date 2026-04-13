'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import ToggleButtonGroup from '../components/ui/ToggleButtonGroup';
import { API_URL } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import type { SeasonConfigResponse, DifficultyDef, DifficultyGroup, DungeonCategory } from '../lib/types';
import CategorySelector from '../components/loot/CategorySelector';
import DropSlotList from '../components/loot/DropSlotList';
import DungeonDrawer from '../components/loot/DungeonDrawer';
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
  type Instance,
  type UpgradeTracks,
} from '../components/loot/types';

type Category = 'raids' | string;

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

// --- Page ---

export default function DropFinderPage() {
  const { t } = useLanguage();
  const { simcInput, hasInput } = useSimContext();

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

  const hasCharacter = hasInput;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [difficulty, setDifficulty] = useState('heroic');
  const [dungeonDiff, setDungeonDiff] = useState('mythic+10');
  const [upgradeLevel, setUpgradeLevel] = useState(0);
  const [category, setCategory] = useState<Category | ''>('mplus');
  // Dungeon pool: set of instance IDs that are "checked" (multi-select)
  const [dungeonPool, setDungeonPool] = useState<Set<string>>(new Set());

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isDungeon = !!activeDungeonCat;
  const isCrafted = activeDungeonCat?.cat.key === 'crafted';
  const isPoolOnly = isDungeon && (activeDungeonCat?.instances.length ?? 0) === 0;
  const selectedInstance =
    selectedId && !selectedId.startsWith('type:')
      ? instances.find((i) => String(i.id) === selectedId)
      : null;

  const dungeonInstances = useMemo(
    () => activeDungeonCat?.instances ?? [],
    [activeDungeonCat]
  );

  // Auto-select M+ pool and initialize dungeon pool on category change
  useEffect(() => {
    if (category === 'raids') {
      setSelectedId('type:raid');
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
  }, [category, activeDungeonCat, dungeonInstances, setSelectedId]);

  // Select all items whenever drops change
  useEffect(() => {
    if (!drops) { setSelected(new Set()); return; }
    const all = new Set<number>();
    for (const items of Object.values(drops)) for (const item of items) all.add(item.item_id);
    setSelected(all);
  }, [drops]);

  // Prune selection when dungeon pool filter changes
  useEffect(() => {
    if (!drops || isRaid || isPoolOnly) return;
    const selectedNames = new Set(
      dungeonInstances.filter((i) => dungeonPool.has(String(i.id))).map((i) => i.name)
    );
    if (selectedNames.size === dungeonInstances.length) return; // all selected = no pruning needed
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
  }, [drops, dungeonPool, dungeonInstances, isRaid, isPoolOnly]);

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
    const ilvl = trackLevels?.find((t) => t.level === selectedDiffDef.level)?.ilvl ?? selectedDiffDef.fixedIlvl;
    const tc = selectedDiffDef.track ? TRACK_COLORS[selectedDiffDef.track] : null;
    return { ilvl, max, tc, track: selectedDiffDef.track, level: selectedDiffDef.level };
  }, [selectedDiffDef, upgradeTracks]);

  // Filter drops by dungeon pool
  const filteredDrops = useMemo(() => {
    if (!drops) return null;
    if (isRaid || dungeonPool.size === 0 || isPoolOnly) return drops;
    // Get names of selected dungeons
    const selectedNames = new Set(
      dungeonInstances.filter((i) => dungeonPool.has(String(i.id))).map((i) => i.name)
    );
    if (selectedNames.size === dungeonInstances.length) return drops; // all selected = no filter
    const filtered: Record<string, DropItem[]> = {};
    for (const [slot, items] of Object.entries(drops)) {
      const kept = items.filter((item) => !item.instance_name || selectedNames.has(item.instance_name));
      if (kept.length > 0) filtered[slot] = kept;
    }
    return filtered;
  }, [drops, dungeonPool, dungeonInstances, isRaid, isPoolOnly]);

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

  function selectAll() {
    if (!filteredDrops) return;
    const all = new Set<number>();
    for (const items of Object.values(filteredDrops)) for (const item of items) all.add(item.item_id);
    setSelected(all);
  }

  const headerLabel =
    selectedInstance?.name ||
    (selectedId.startsWith('type:') ? (isRaid ? t('loot.allRaids') : t('loot.allDungeons')) : '');

  // Category label for dynamic title
  const categoryLabel = useMemo(() => {
    if (isRaid) return t('loot.raids');
    if (activeDungeonCat) return activeDungeonCat.cat.label;
    return '';
  }, [isRaid, activeDungeonCat, t]);

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

  // Sim submission
  const buildPayload = useCallback(() => {
    if (!filteredDrops || selected.size === 0) return null;
    const dropItems: DropItem[] = [];
    for (const items of Object.values(filteredDrops)) {
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
  }, [filteredDrops, selected, simcInput, difficulty, dungeonDiff, upgradeLevel, upgradeTracks]);

  const validate = useCallback(() => {
    if (!filteredDrops || selected.size === 0) return t('validation.selectItems');
    return null;
  }, [filteredDrops, selected, t]);

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
        <h1 className="font-headline font-black text-4xl uppercase tracking-tighter text-on-surface mb-2">
          Drop Finder{categoryLabel ? ` — ${categoryLabel}` : ''}
        </h1>
        <p className="text-sm text-on-surface-variant max-w-2xl">
          Find and simulate the best gear drops from across Azeroth. Refine your search by activity type and difficulty.
        </p>
      </div>

      <TalentPicker />

      {/* Category pills */}
      <div className="card p-5">
        <label className="label-text">{t('dropFinder.source')}</label>
        <CategorySelector
          category={category}
          onChange={setCategory}
          dungeonCats={dungeonCats}
        />
      </div>

      {/* Dungeon pool drawer */}
      {isDungeon && !isPoolOnly && dungeonInstances.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-base font-bold text-on-surface">{t('dropFinder.dungeonPool') ?? 'Dungeon pool'}</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {t('dropFinder.dungeonPoolDesc') ?? 'All season dungeons start selected. Narrow the pool only when you want to exclude sources.'}
              </p>
            </div>
            <span className="text-xs text-on-surface-variant">
              {dungeonInstances.filter((i) => dungeonPool.has(String(i.id))).length} {t('dropFinder.selected') ?? 'selected'}
            </span>
          </div>
          <DungeonDrawer
            instances={dungeonInstances}
            allKey={allKey}
            allLabel={t('loot.allDungeons')}
            selectedIds={dungeonPool}
            onChange={setDungeonPool}
          />
        </div>
      )}

      {/* Raid instance selection (single-select for raids) */}

      {/* Difficulty + upgrade level */}
      {(isRaid || isDungeon) && activeDifficulties.length > 0 && (
        <div className="card p-5">
            <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
              {/* Difficulty select */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  {t('dropFinder.difficultyPreset') ?? 'Difficulty preset'}
                </span>
                <select
                  value={currentDiff}
                  onChange={(e) => {
                    const key = e.target.value;
                    const diff = activeDifficulties.find((d) => d.key === key);
                    if (isRaid) {
                      setDifficulty(key);
                      setUpgradeLevel(0);
                    } else {
                      setDungeonDiff(key);
                      setUpgradeLevel(diff?.level ?? 0);
                    }
                  }}
                  className="h-[46px] w-full rounded-xl border border-outline-variant/20 bg-surface-container-high px-3.5 text-sm font-medium text-on-surface outline-none focus:border-gold/40"
                >
                  {activeDifficultyGroups ? (
                    activeDifficultyGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.difficulties.map((d) => {
                          const trackLevels = d.track ? upgradeTracks[d.track] : null;
                          const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
                          return (
                            <option key={d.key} value={d.key}>
                              {d.label}{ilvl ? ` — ilvl ${ilvl}` : ''}{d.track ? ` (${TRACK_SHORT[d.track] ?? d.track})` : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))
                  ) : (
                    activeDifficulties.map((d) => {
                      const trackLevels = d.track ? upgradeTracks[d.track] : null;
                      const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
                      return (
                        <option key={d.key} value={d.key}>
                          {d.label}{ilvl ? ` — ilvl ${ilvl}` : ''}{d.track && !isCrafted ? ` (${TRACK_SHORT[d.track] ?? d.track})` : ''}
                        </option>
                      );
                    })
                  )}
                </select>
              </div>

              {/* Upgrade level */}
              {currentTrackInfo && drops ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    {t('dropFinder.upgradeLevel')}
                  </span>
                  <select
                    value={upgradeLevel}
                    onChange={(e) => setUpgradeLevel(Number(e.target.value))}
                    className="h-[46px] w-full rounded-xl border border-outline-variant/20 bg-surface-container-high px-3.5 text-sm font-medium text-on-surface outline-none focus:border-gold/40"
                  >
                    {upgradeLevelOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}{'sublabel' in opt && opt.sublabel ? ` — ilvl ${opt.sublabel}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div />
              )}
            </div>

            {/* Mini pills */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/15 bg-surface-container-high px-2.5 py-1.5 text-xs text-on-surface-variant">
                <strong className="font-bold text-on-surface">{t('dropFinder.source')}</strong>
                {categoryLabel}
              </span>
              {selectedDiffInfo?.track && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs ${selectedDiffInfo.tc?.border ?? 'border-outline-variant/15'} ${selectedDiffInfo.tc?.bg ?? 'bg-surface-container-high'}`}>
                  <strong className={`font-bold ${selectedDiffInfo.tc?.text ?? 'text-on-surface'}`}>
                    {t('dropFinder.upgradeLabel') ?? 'Upgrade'}
                  </strong>
                  <span className={selectedDiffInfo.tc?.text ?? 'text-on-surface-variant'}>
                    {TRACK_SHORT[selectedDiffInfo.track] ?? selectedDiffInfo.track} {selectedDiffInfo.level}/{selectedDiffInfo.max}
                  </span>
                </span>
              )}
            </div>
        </div>
      )}

      {/* Raid instance selection (single-select for raids) */}
      {isRaid && raids.length > 0 && (
        <div className="card p-5">
          <label className="label-text">{t('dropFinder.selectRaid')}</label>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedId('type:raid')}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                selectedId === 'type:raid'
                  ? 'border-gold/40 bg-gold/[0.08] text-gold'
                  : 'border-transparent bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
              }`}
            >
              {t('loot.allRaids')}
            </button>
            {raids.map((inst) => (
              <button
                key={inst.id}
                onClick={() => setSelectedId(String(inst.id))}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                  selectedId === String(inst.id)
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : 'border-transparent bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                }`}
              >
                {inst.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Spec filter */}
      {className ? (
        <div className="flex flex-wrap items-center gap-2">
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
                      {isMain && <span className="ml-1 text-[11px] opacity-50">{t('dropFinder.mainSpec')}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">
          {t('dropFinder.pasteExport')}
        </p>
      )}

      {loading && <Spinner />}

      {!loading && selectedId && !filteredDrops && (
        <p className="py-6 text-center text-sm text-muted">
          {t('dropFinder.noDrops')}
        </p>
      )}

      {!loading && filteredDrops && (
        <>
          <DropSlotList
            drops={filteredDrops}
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
            equippedEmbellishments={equippedEmbellishments}
          />

          <SimcDownloadBanner />
          <ErrorAlert message={error} />
        </>
      )}

      {!selectedId && !loading && !category && (
        <p className="py-6 text-center text-sm text-muted">{t('dropFinder.selectCategory')}</p>
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
