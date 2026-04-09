'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import { useSimContext } from '../components/sim-config/SimContext';
import ToggleButtonGroup from '../components/ui/ToggleButtonGroup';
import { API_URL } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import type { SeasonConfigResponse, DifficultyDef, DungeonCategory } from '../lib/types';
import CategorySelector from '../components/loot/CategorySelector';
import DropSlotList from '../components/loot/DropSlotList';
import DungeonGrid from '../components/loot/DungeonGrid';
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
  const { simcInput } = useSimContext();

  // Spec selection: main spec on by default, off-specs toggleable
  const detectedClass = useMemo(() => detectClass(simcInput), [simcInput]);
  const detectedSpec = useMemo(() => detectSpec(simcInput), [simcInput]);
  const allSpecs = useMemo(
    () => (detectedClass ? getClassSpecs(detectedClass) : []),
    [detectedClass]
  );
  const [activeSpecs, setActiveSpecs] = useState<Set<string>>(new Set());
  const [prevSpec, setPrevSpec] = useState<string | null>(null);

  // Reset active specs when detected spec changes (sync, not effect)
  if (detectedSpec !== prevSpec) {
    setPrevSpec(detectedSpec);
    setActiveSpecs(detectedSpec ? new Set([detectedSpec]) : new Set());
  }

  function toggleSpec(spec: string) {
    setActiveSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(spec)) {
        // Don't allow deselecting the last spec
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

  // Count equipped embellished items (bonus 8960 = embellishment limit category 512)
  const equippedEmbellishments = useMemo(() => {
    if (!simcInput) return 0;
    let count = 0;
    // Match equipped item lines (not commented out with #)
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

  useEffect(() => {
    setSelected(new Set());
  }, [drops]);

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isDungeon = !!activeDungeonCat;
  const isCrafted = activeDungeonCat?.cat.key === 'crafted';
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

  const dungeonInstances = useMemo(
    () => activeDungeonCat?.instances ?? [],
    [activeDungeonCat]
  );
  const activeInstances = isRaid ? raids : dungeonInstances;
  const hasImages = activeInstances.some((i) => i.image_url);

  const allKey = isRaid
    ? 'type:raid'
    : String(activeDungeonCat?.cat.poolInstanceId ?? 'type:dungeon');

  const instanceOptions = useMemo(() => {
    const list = isRaid ? raids : dungeonInstances;
    return [
      { key: allKey, label: isRaid ? t('loot.allRaids') : isCrafted ? t('loot.allCrafted') : t('loot.allDungeons') },
      ...list.map((inst) => ({ key: String(inst.id), label: inst.name })),
    ];
  }, [isRaid, raids, dungeonInstances, allKey, t]);

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
    if (!drops) return;
    const all = new Set<number>();
    for (const items of Object.values(drops)) for (const item of items) all.add(item.item_id);
    setSelected(all);
  }

  const headerLabel =
    selectedInstance?.name ||
    (selectedId.startsWith('type:') ? (isRaid ? t('loot.allRaids') : t('loot.allDungeons')) : '');

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
    if (!drops || selected.size === 0) return t('validation.selectItems');
    return null;
  }, [drops, selected, t]);

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
    <div className="space-y-6 pb-20">
      <TalentPicker />
      <CategorySelector
          category={category}
          onChange={(key) => {
            setCategory(key);
            // Auto-select pool for crafted (no instance picker needed)
            const dc = dungeonCats.find((d) => d.cat.key === key);
            if (dc?.cat.key === 'crafted') {
              setSelectedId(String(dc.cat.poolInstanceId));
              setDungeonDiff(dc.cat.defaultDifficulty);
            } else {
              setSelectedId('');
            }
          }}
          dungeonCats={dungeonCats}
        />

      {category && !isCrafted && hasImages ? (
        <DungeonGrid
          value={selectedId}
          onChange={setSelectedId}
          instances={activeInstances}
          allKey={allKey}
          allLabel={isRaid ? t('loot.allRaids') : t('loot.allDungeons')}
        />
      ) : category && !isCrafted ? (
        <div className="card p-5">
          <label className="label-text">{isRaid ? t('dropFinder.selectRaid') : t('dropFinder.selectDungeon')}</label>
          <ToggleButtonGroup
            value={selectedId}
            onChange={setSelectedId}
            options={instanceOptions}
          />
        </div>
      ) : null}

      {(isRaid || isDungeon) && selectedId && activeDifficulties.length > 0 && (
        <div className="card space-y-4 p-5">
          <div>
            <label className="label-text">{t('dropFinder.difficulty')}</label>
            <div className="flex flex-wrap gap-1.5">
              {activeDifficulties.map((d) => {
                const currentDiff = isRaid ? difficulty : dungeonDiff;
                const isActive = currentDiff === d.key;
                const trackLevels = d.track ? upgradeTracks[d.track] : null;
                const max = trackLevels?.at(-1)?.max_level ?? d.level;
                const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
                const tc = d.track ? TRACK_COLORS[d.track] : null;
                return (
                  <button
                    key={d.key}
                    onClick={() => {
                      if (isRaid) setDifficulty(d.key);
                      else setDungeonDiff(d.key);
                      setUpgradeLevel(0);
                    }}
                    className={`flex min-w-[4.5rem] flex-col items-center rounded-lg border px-3 py-2 text-center transition-all duration-150 ${
                      isActive && tc
                        ? `${tc.border} ${tc.bg}`
                        : isActive
                          ? 'border-gold/40 bg-gold/[0.08]'
                          : 'border-transparent bg-surface-container-high hover:bg-surface-container-highest'
                    }`}
                  >
                    <span
                      className={`text-lg font-black leading-none ${isActive && tc ? tc.text : isActive ? 'text-gold' : 'text-on-surface'}`}
                    >
                      {d.label}
                    </span>
                    {ilvl && (
                      <span
                        className={`mt-1 font-mono text-[13px] font-medium tabular-nums ${isActive ? 'text-on-surface-variant' : 'text-on-surface-variant/60'}`}
                      >
                        ilvl {ilvl}
                      </span>
                    )}
                    {d.track && !isCrafted ? (
                      <span
                        className={`mt-0.5 text-[12px] font-semibold ${tc?.text ?? 'text-on-surface-variant'} ${isActive ? 'opacity-100' : 'opacity-60'}`}
                      >
                        {TRACK_SHORT[d.track] ?? d.track} {d.level}/{max}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {currentTrackInfo && drops && (
            <div>
              <label className="label-text">{t('dropFinder.upgradeLevel')}</label>
              <ToggleButtonGroup
                value={upgradeLevel}
                onChange={setUpgradeLevel}
                options={upgradeLevelOptions}
                size="sm"
              />
            </div>
          )}
        </div>
      )}

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

      {!loading && selectedId && !drops && (
        <p className="py-6 text-center text-sm text-muted">
          {t('dropFinder.noDrops')}
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
            equippedEmbellishments={equippedEmbellishments}
          />

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
