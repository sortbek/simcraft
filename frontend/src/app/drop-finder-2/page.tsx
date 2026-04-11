'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import { useSimContext } from '../components/sim-config/SimContext';
import ToggleButtonGroup from '../components/ui/ToggleButtonGroup';
import { useSimSubmit } from '../lib/useSimSubmit';
import type { DifficultyDef, DifficultyGroup } from '../lib/types';
import InstanceList from '../components/loot/InstanceList';
import ItemTable from '../components/loot/ItemTable';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import { useLanguage } from '../lib/i18n';
import {
  useDropFinderData,
  TRACK_SHORT,
  TRACK_COLORS,
  PVP_KEYS,
  PROFESSION_KEYS,
  type Category,
} from '../lib/useDropFinderData';
import {
  detectClass,
  detectSpec,
  formatSpecName,
  getClassSpecs,
  getTrackInfo,
  resolveUpgrade,
  type DropItem,
} from '../components/loot/types';

// --- Category icon SVG paths ---

const CATEGORY_ICONS: Record<string, string> = {
  raids: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
  mplus: 'M8 1v14M1 8h14M4 4l8 8M12 4l-8 8',
  'normal-dungeons': 'M2 2h12v12H2zM5 5h6M5 8h6M5 11h3',
  delves: 'M8 1L1 6v4l7 5 7-5V6L8 1zM1 6l7 5 7-5',
  prey: 'M8 2L3 5v6l5 3 5-3V5L8 2zM8 8V2M8 8l5-3M8 8l-5-3',
  pvp: 'M8 1l2 3h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z',
  professions: 'M4 1l4 5 4-5M3 6h10l-1 5H4L3 6zM5 11v3h6v-3',
  catalyst: 'M8 1a7 7 0 100 14A7 7 0 008 1zM5 8h6M8 5v6',
};

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

export default function DropFinder2Page() {
  const { t } = useLanguage();
  const { simcInput } = useSimContext();

  // Spec selection
  const detectedClass = useMemo(() => detectClass(simcInput), [simcInput]);
  const detectedSpec = useMemo(() => detectSpec(simcInput), [simcInput]);
  const allSpecs = useMemo(() => (detectedClass ? getClassSpecs(detectedClass) : []), [detectedClass]);
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
  } = useDropFinderData(simcInput, activeSpecs);

  // Embellishment count
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

  const hasCharacter = simcInput.trim().length >= 10;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [difficulty, setDifficulty] = useState('heroic');
  const [dungeonDiff, setDungeonDiff] = useState('mythic+10');
  const [upgradeLevel, setUpgradeLevel] = useState(0);
  const [category, setCategory] = useState<Category | ''>('');

  // Build bento categories — 5 max, M+ is the hero card
  const BENTO_ORDER = ['mplus', 'raids', 'normal-dungeons', 'delves', 'pvp'];
  const bentoCategories = useMemo(() => {
    const result: { key: string; label: string; icon: string }[] = [];
    for (const key of BENTO_ORDER) {
      if (key === 'raids') {
        result.push({ key: 'raids', label: t('loot.raids'), icon: CATEGORY_ICONS.raids });
      } else if (key === 'pvp') {
        if (dungeonCats.some((dc) => PVP_KEYS.includes(dc.cat.key))) {
          result.push({ key: 'pvp', label: 'PVP', icon: CATEGORY_ICONS.pvp });
        }
      } else {
        const dc = dungeonCats.find((d) => d.cat.key === key);
        if (dc) {
          result.push({
            key: dc.cat.key,
            label: dc.cat.label,
            icon: CATEGORY_ICONS[dc.cat.key] || CATEGORY_ICONS['normal-dungeons'],
          });
        }
      }
    }
    return result;
  }, [dungeonCats, t]);

  // Grouped source handling
  const isGroupedSource = category === 'pvp' || category === 'professions';
  const groupKeys = category === 'pvp' ? PVP_KEYS : category === 'professions' ? PROFESSION_KEYS : [];
  const availableGroupCats = useMemo(
    () => dungeonCats.filter((dc) => groupKeys.includes(dc.cat.key)),
    [dungeonCats, groupKeys]
  );
  const [subCategory, setSubCategory] = useState('');
  const [prevCategory, setPrevCategory] = useState('');

  if (category !== prevCategory) {
    setPrevCategory(category);
    if (category === 'pvp' || category === 'professions') {
      const keys = category === 'pvp' ? PVP_KEYS : PROFESSION_KEYS;
      const first = dungeonCats.find((dc) => keys.includes(dc.cat.key));
      setSubCategory(first?.cat.key ?? keys[0]);
    } else {
      setSubCategory('');
    }
  }

  const effectiveCategory = isGroupedSource ? subCategory : category;

  // Derived state
  const isRaid = effectiveCategory === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === effectiveCategory);
  const isDungeon = !!activeDungeonCat;
  const isCrafted = activeDungeonCat?.cat.key === 'crafted';
  const isPoolOnly = isDungeon && (activeDungeonCat?.instances.length ?? 0) === 0;

  const activeInstances = isRaid ? raids : (activeDungeonCat?.instances ?? []);
  const allKey = isRaid ? 'type:raid' : String(activeDungeonCat?.cat.poolInstanceId ?? 'type:dungeon');
  const allLabel = isRaid ? t('loot.allRaids') : isCrafted ? t('loot.allCrafted') : t('loot.allDungeons');

  const selectedInstance = selectedId && !selectedId.startsWith('type:')
    ? instances.find((i) => String(i.id) === selectedId)
    : null;

  // Auto-select when category changes
  useEffect(() => {
    if (!effectiveCategory) {
      setSelectedId('');
      return;
    }
    const dc = dungeonCats.find((d) => d.cat.key === effectiveCategory);
    if (effectiveCategory === 'raids') {
      setSelectedId('type:raid');
    } else if (dc && dc.instances.length === 0) {
      setSelectedId(String(dc.cat.poolInstanceId));
    } else if (dc) {
      setSelectedId(String(dc.cat.poolInstanceId));
    } else {
      setSelectedId('');
    }
    if (dc) {
      setDungeonDiff(dc.cat.defaultDifficulty);
      const allDiffs = dc.cat.difficultyGroups
        ? dc.cat.difficultyGroups.flatMap((g) => g.difficulties)
        : dc.cat.difficulties;
      const defaultDiff = allDiffs.find((d) => d.key === dc.cat.defaultDifficulty);
      setUpgradeLevel(defaultDiff?.level ?? 0);
    }
  }, [effectiveCategory, dungeonCats, setSelectedId]);

  useEffect(() => {
    setSelected(new Set());
  }, [drops]);

  // Difficulty/track info
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

  const headerLabel = selectedInstance?.name
    || (selectedId.startsWith('type:') ? (isRaid ? t('loot.allRaids') : t('loot.allDungeons')) : '');

  // Sim submission
  const buildPayload = useCallback(() => {
    if (!drops || selected.size === 0) return null;
    const dropItems: DropItem[] = [];
    for (const items of Object.values(drops)) {
      for (const item of items) {
        if (selected.has(item.item_id)) {
          const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
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
    if (!drops || selected.size === 0) return t('validation.selectItems');
    return null;
  }, [drops, selected, t]);

  const { submit: handleSubmit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/droptimizer/sim',
    buildPayload,
    validate,
  });

  const submitLabel = !hasCharacter
    ? t('validation.pasteSimcDropFinder')
    : selected.size === 0
      ? t('validation.selectItemsDropFinder')
      : buttonLabel(t('button.findUpgrades', { count: selected.size }));

  const hasInstances = activeInstances.length > 0;

  return (
    <div className="space-y-6 pb-20">
      {/* Page header */}
      <div>
        <h1 className="font-headline font-black text-4xl uppercase tracking-tighter text-on-surface mb-2">
          Drop Finder
        </h1>
        <p className="text-sm text-on-surface-variant max-w-2xl">
          Find and simulate the best gear drops from across Azeroth. Refine your search by activity type and difficulty.
        </p>
      </div>

      {/* Bento category grid */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-6">
        {bentoCategories.map((cat) => {
          const isActive = category === cat.key;
          const isHero = cat.key === 'mplus';
          return (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`group relative overflow-hidden rounded-xl p-6 text-left transition-all hover:scale-[1.02] active:scale-95 ${
                isHero ? 'md:col-span-2' : ''
              } ${
                isActive && isHero
                  ? 'bg-primary-container shadow-xl shadow-primary/10'
                  : isActive
                    ? 'border-gold/50 bg-gold/[0.06] border'
                    : 'bg-surface-container-low border border-outline-variant/10 hover:bg-surface-container-high'
              }`}
            >
              <div className="relative z-10 flex flex-col h-full justify-between gap-3">
                <svg
                  className={`${isHero ? 'h-10 w-10' : 'h-8 w-8'} ${
                    isActive && isHero ? 'text-on-primary-container' : isActive ? 'text-gold' : 'text-primary'
                  }`}
                  viewBox="0 0 16 16" fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d={cat.icon} />
                </svg>
                <div>
                  <p className={`font-headline font-bold uppercase ${
                    isHero ? 'text-xl font-black' : 'text-sm'
                  } ${
                    isActive && isHero ? 'text-on-primary-container' : isActive ? 'text-gold' : 'text-on-surface-variant'
                  }`}>
                    {cat.label}
                  </p>
                  {isHero && (
                    <p className={`text-xs ${isActive ? 'text-on-primary-container/70' : 'text-on-surface-variant/50'}`}>
                      Season Dungeons
                    </p>
                  )}
                </div>
              </div>
              {isActive && (
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent pointer-events-none" />
              )}
            </button>
          );
        })}
      </section>

      {/* Sub-category selector for PVP / Professions */}
      {isGroupedSource && availableGroupCats.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {availableGroupCats.map((dc) => {
            const isActive = dc.cat.key === subCategory;
            return (
              <button
                key={dc.cat.key}
                onClick={() => setSubCategory(dc.cat.key)}
                className={`rounded-lg border px-4 py-2.5 text-[14px] font-semibold transition-all ${
                  isActive
                    ? 'border-gold/50 bg-gold/[0.06] text-primary'
                    : 'border-outline-variant/10 bg-surface-container-high text-on-surface hover:border-gold/20 hover:text-primary'
                }`}
              >
                {dc.cat.label}
              </button>
            );
          })}
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
        <p className="text-xs text-muted">{t('dropFinder.pasteExport')}</p>
      )}

      {/* Two-column layout */}
      {effectiveCategory && (
        <div className={`grid gap-8 items-start ${hasInstances && !isPoolOnly ? 'grid-cols-1 lg:grid-cols-12' : ''}`}>
          {/* Left column */}
          <div className={`flex flex-col gap-6 ${hasInstances && !isPoolOnly ? 'lg:col-span-4' : ''}`}>
            {/* Configuration card */}
            {(isRaid || isDungeon) && activeDifficulties.length > 0 && (
              <div className="card p-6">
                <h3 className="font-headline font-black text-sm uppercase text-primary mb-6 tracking-widest">
                  Configuration
                </h3>

                {/* Difficulty selector */}
                <div className="mb-6">
                  <label className="block text-[10px] font-bold uppercase text-on-surface-variant/60 mb-3 tracking-wider">
                    Difficulty Level
                  </label>
                  {activeDifficultyGroups ? (
                    /* Grouped difficulties (Delves, Prey, Catalyst) — compact pills per group */
                    <div className="space-y-4">
                      {activeDifficultyGroups.map((group) => (
                        <div key={group.label}>
                          <label className="block text-[10px] font-bold uppercase text-on-surface-variant/40 mb-2">
                            {group.label}
                          </label>
                          <div className="flex flex-wrap gap-1">
                            {group.difficulties.map((d) => {
                              const isActive = dungeonDiff === d.key;
                              const tc = d.track ? TRACK_COLORS[d.track] : null;
                              return (
                                <button
                                  key={d.key}
                                  onClick={() => {
                                    setDungeonDiff(d.key);
                                    setUpgradeLevel(d.level ?? 0);
                                  }}
                                  className={`rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-all ${
                                    isActive && tc
                                      ? `${tc.bg} ${tc.text}`
                                      : isActive
                                        ? 'bg-gold/[0.12] text-gold'
                                        : 'text-on-surface-variant/60 hover:text-white hover:bg-surface-container-high'
                                  }`}
                                >
                                  {d.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : activeDifficulties.length <= 6 ? (
                    /* Few options (Raids, normal dungeons) — segmented control */
                    <div className="flex rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-1">
                      {activeDifficulties.map((d) => {
                        const currentDiff = isRaid ? difficulty : dungeonDiff;
                        const isActive = currentDiff === d.key;
                        return (
                          <button
                            key={d.key}
                            onClick={() => {
                              if (isRaid) setDifficulty(d.key);
                              else setDungeonDiff(d.key);
                              setUpgradeLevel(0);
                            }}
                            className={`flex-1 rounded-md py-2 text-xs font-bold uppercase transition-all ${
                              isActive
                                ? 'bg-secondary-container text-primary shadow-sm'
                                : 'text-on-surface-variant hover:text-white'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    /* Many flat options (M+) — dropdown */
                    <div className="relative">
                      <select
                        value={isRaid ? difficulty : dungeonDiff}
                        onChange={(e) => {
                          const key = e.target.value;
                          if (isRaid) setDifficulty(key);
                          else setDungeonDiff(key);
                          const diff = activeDifficulties.find((d) => d.key === key);
                          setUpgradeLevel(diff?.level ?? 0);
                        }}
                        className="input-field w-full !bg-surface-container-high !pr-9 appearance-none cursor-pointer"
                      >
                        {activeDifficulties.map((d) => {
                          const tc = d.track ? TRACK_SHORT[d.track] : null;
                          const trackLevels = d.track ? upgradeTracks[d.track] : null;
                          const max = trackLevels?.at(-1)?.max_level ?? d.level;
                          const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
                          return (
                            <option key={d.key} value={d.key}>
                              {d.label}{tc ? ` — ${tc} ${d.level}/${max}` : ''}{ilvl ? ` (ilvl ${ilvl})` : ''}
                            </option>
                          );
                        })}
                      </select>
                      <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Upgrade level slider */}
                {currentTrackInfo && drops && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-[10px] font-bold uppercase text-on-surface-variant/60 tracking-wider">
                        Upgrade Level
                      </label>
                      <span className="text-primary font-headline font-bold text-xs">
                        {upgradeLevel === 0 ? 'Base' : `Level ${upgradeLevel}/${currentTrackInfo.levels.at(-1)?.max_level ?? upgradeLevel}`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={currentTrackInfo.levels.length}
                      value={upgradeLevel}
                      onChange={(e) => setUpgradeLevel(Number(e.target.value))}
                      className="w-full h-1 rounded-lg appearance-none cursor-pointer accent-primary bg-surface-container-highest"
                    />
                    <div className="flex justify-between mt-2 px-1 text-[10px] text-on-surface-variant/40 font-bold">
                      <span>Base</span>
                      {currentTrackInfo.levels.map((lvl) => (
                        <span key={lvl.level}>{lvl.level}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Instance list */}
            {hasInstances && !isPoolOnly && (
              <InstanceList
                key={effectiveCategory}
                instances={activeInstances}
                selectedId={selectedId}
                onSelect={setSelectedId}
                allKey={allKey}
                allLabel={allLabel}
              />
            )}
          </div>

          {/* Right column */}
          <div className={hasInstances && !isPoolOnly ? 'lg:col-span-8' : ''}>
            {loading && <Spinner />}

            {!loading && selectedId && !drops && (
              <p className="py-6 text-center text-sm text-muted">{t('dropFinder.noDrops')}</p>
            )}

            {!loading && drops && (
              <>
                <ItemTable
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
                  onSelectAll={() => {
                    if (!drops) return;
                    const all = new Set<number>();
                    for (const items of Object.values(drops)) for (const item of items) all.add(item.item_id);
                    setSelected(all);
                  }}
                  onClear={() => setSelected(new Set())}
                  difficulty={difficulty}
                  dungeonDiff={dungeonDiff}
                  upgradeLevel={upgradeLevel}
                  upgradeTracks={upgradeTracks}
                  headerLabel={headerLabel}
                  equippedEmbellishments={equippedEmbellishments}
                />
                <ErrorAlert message={error} />
              </>
            )}
          </div>
        </div>
      )}

      {!effectiveCategory && (
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
