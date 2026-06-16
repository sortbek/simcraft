'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, fetchJson } from '../../lib/api';
import {
  startRun,
  getRun,
  type Roster,
  type RosterReport,
} from '../../lib/rosters';
import type {
  SeasonConfigResponse,
  DifficultyDef,
  DifficultyGroup,
  DungeonCategory,
} from '../../lib/types';
import type { Instance, UpgradeTracks } from '../loot/types';
import RosterReportView from './RosterReportView';
import FightStyleSelector from '../sim-config/FightStyleSelector';
import CategorySelector from '../loot/CategorySelector';
import DifficultySelect from '../loot/DifficultySelect';
import UpgradeSelect from '../loot/UpgradeSelect';

export default function RosterRunPanel({ roster }: { roster: Roster }) {
  // Source data
  const [instances, setInstances] = useState<Instance[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(null);
  const [upgradeTracks, setUpgradeTracks] = useState<UpgradeTracks>({});

  // Config selection
  const [category, setCategory] = useState<string>('raids');
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<string>('heroic');
  const [upgradeLevel, setUpgradeLevel] = useState<number>(0);
  const [selectedBosses, setSelectedBosses] = useState<Set<number>>(new Set());

  // Sim options
  const [targetError, setTargetError] = useState<number>(0.1);
  const [fightStyle, setFightStyle] = useState<string>('Patchwerk');

  // Run state
  const [running, setRunning] = useState(false);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [done, setDone] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [report, setReport] = useState<RosterReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Fetch source data on mount
  useEffect(() => {
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then(setInstances)
      .catch(() => {});
    fetchJson<SeasonConfigResponse>(`${API_URL}/api/season-config`)
      .then(setSeasonConfig)
      .catch(() => {});
    fetchJson<UpgradeTracks>(`${API_URL}/api/upgrade-tracks`)
      .then(setUpgradeTracks)
      .catch(() => {});
  }, []);

  // Stop polling when roster changes / unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [roster.id, stopPolling]);

  // Derive raids + dungeon categories (mirror DropFinderContent)
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

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isCrafted = activeDungeonCat?.cat.key === 'crafted';

  // Default the selected raid to the first available raid
  useEffect(() => {
    if (raids.length > 0 && selectedRaidId === null) {
      setSelectedRaidId(raids[0].id);
    }
  }, [raids, selectedRaidId]);

  // Effective instance id: raid id, or the dungeon category's pool instance id
  const instanceId: number | null = isRaid
    ? selectedRaidId
    : (activeDungeonCat?.cat.poolInstanceId ?? null);

  // Active difficulties for the current category (mirror DropFinderContent)
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

  // Reset difficulty + upgrade level to the category's default when category changes
  useEffect(() => {
    if (activeDifficulties.length === 0) return;
    const defaultKey = isRaid
      ? (activeDifficulties.find((d) => d.key === 'heroic')?.key ?? activeDifficulties[0].key)
      : (activeDungeonCat?.cat.defaultDifficulty ?? activeDifficulties[0].key);
    if (!activeDifficulties.some((d) => d.key === difficulty)) {
      setDifficulty(defaultKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, activeDifficulties]);

  // Track info derived from the selected difficulty's track (drops-independent)
  const selectedDiffDef = activeDifficulties.find((d) => d.key === difficulty);
  const currentTrackInfo = useMemo(() => {
    if (isCrafted) return null;
    const track = selectedDiffDef?.track;
    if (!track || !upgradeTracks[track]) return null;
    return { name: track, levels: upgradeTracks[track] };
  }, [isCrafted, selectedDiffDef, upgradeTracks]);

  const upgradeLevelOptions = useMemo(() => {
    if (!currentTrackInfo) return [{ key: 0, label: 'As dropped' }];
    return [
      { key: 0, label: 'As dropped' },
      ...currentTrackInfo.levels.map((lvl) => ({
        key: lvl.level,
        label: `${currentTrackInfo.name} ${lvl.level}/${lvl.max_level}`,
        sublabel: String(lvl.ilvl),
      })),
    ];
  }, [currentTrackInfo]);

  // Keep upgrade level valid for the current options
  useEffect(() => {
    if (!upgradeLevelOptions.some((o) => o.key === upgradeLevel)) {
      setUpgradeLevel(0);
    }
  }, [upgradeLevelOptions, upgradeLevel]);

  // Selected raid's encounters (raids only)
  const selectedRaid = isRaid ? raids.find((r) => r.id === selectedRaidId) : undefined;
  const raidEncounters = selectedRaid?.encounters ?? [];

  // Default all bosses selected whenever the selected raid changes
  useEffect(() => {
    if (isRaid && selectedRaid) {
      setSelectedBosses(new Set(selectedRaid.encounters.map((e) => e.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRaidId, isRaid, selectedRaid?.encounters.length]);

  const toggleBoss = useCallback((id: number) => {
    setSelectedBosses((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (instanceId === null) return;
    setError(null);
    setReport(null);
    setRunning(true);
    setProgressPct(0);
    setDone(0);
    setTotal(0);

    const encounters =
      isRaid && selectedRaidId ? Array.from(selectedBosses) : undefined;

    const started = await startRun(roster.id, instanceId, difficulty, {
      target_error: targetError,
      iterations: 100000,
      fight_style: fightStyle,
      upgrade_level: upgradeLevel,
      ...(encounters && encounters.length ? { encounters } : {}),
    });
    if (!started) {
      setError('Failed to start run. Make sure all members have armory status "ok".');
      setRunning(false);
      return;
    }

    const runId = started.run_id;

    intervalRef.current = setInterval(async () => {
      const status = await getRun(runId);
      if (!status) {
        stopPolling();
        setRunning(false);
        setError('Lost connection to run. Please try again.');
        return;
      }
      if (status.progress_pct !== undefined) setProgressPct(status.progress_pct);
      if (status.done !== undefined) setDone(status.done);
      if (status.total !== undefined) setTotal(status.total);

      if (status.status === 'done') {
        stopPolling();
        setRunning(false);
        setReport(status.report ?? null);
      }
    }, 2000);
  }, [
    roster.id,
    instanceId,
    difficulty,
    targetError,
    fightStyle,
    upgradeLevel,
    isRaid,
    selectedRaidId,
    selectedBosses,
    stopPolling,
  ]);

  return (
    <div className="space-y-6 border-t border-outline-variant/10 pt-6">
      <div className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
        Loot Report
      </div>

      {/* Source category: raids vs dungeon categories */}
      <CategorySelector category={category} onChange={setCategory} dungeonCats={dungeonCats} />

      <div className="space-y-4">
        {/* Raid picker (raids only) + difficulty + upgrade level */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isRaid && (
            <div className="space-y-1">
              <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Raid
              </label>
              <select
                value={selectedRaidId ?? ''}
                onChange={(e) => setSelectedRaidId(Number(e.target.value))}
                disabled={running || raids.length === 0}
                className="w-full rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {raids.length === 0 && <option value="">Loading…</option>}
                {raids.map((raid) => (
                  <option key={raid.id} value={raid.id}>
                    {raid.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeDifficulties.length > 0 && (
            <div className="space-y-1">
              <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Difficulty
              </label>
              <div className={running ? 'pointer-events-none opacity-50' : ''}>
                <DifficultySelect
                  value={difficulty}
                  onChange={(key) => setDifficulty(key)}
                  difficulties={activeDifficulties}
                  difficultyGroups={activeDifficultyGroups}
                  upgradeTracks={upgradeTracks}
                  isCrafted={isCrafted}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Upgrade level
            </label>
            <div className={running ? 'pointer-events-none opacity-50' : ''}>
              <UpgradeSelect
                value={upgradeLevel}
                onChange={setUpgradeLevel}
                options={upgradeLevelOptions}
              />
            </div>
          </div>
        </div>

        {/* Boss toggles (raids only) */}
        {isRaid && raidEncounters.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Bosses
              </label>
              <button
                type="button"
                onClick={() => setSelectedBosses(new Set(raidEncounters.map((e) => e.id)))}
                disabled={running}
                className="text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSelectedBosses(new Set())}
                disabled={running}
                className="text-xs font-semibold text-on-surface-variant hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                None
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {raidEncounters.map((boss) => {
                const checked = selectedBosses.has(boss.id);
                return (
                  <label
                    key={boss.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      checked
                        ? 'border-primary/30 bg-primary/10 text-on-surface'
                        : 'border-outline-variant/10 bg-surface-container-high text-on-surface-variant'
                    } ${running ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBoss(boss.id)}
                      disabled={running}
                      className="accent-primary"
                    />
                    <span className="truncate">{boss.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Sim options + generate */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Target error
            </label>
            <input
              type="number"
              step={0.01}
              min={0.01}
              value={targetError}
              onChange={(e) => setTargetError(Number(e.target.value))}
              disabled={running}
              className="w-24 rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="w-44 space-y-1">
            <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Fight style
            </label>
            <div className={running ? 'pointer-events-none opacity-50' : ''}>
              <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={running || instanceId === null}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-headline text-xs font-bold uppercase tracking-wider text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {running ? 'Running…' : 'Generate'}
          </button>
        </div>
      </div>

      {running && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-on-surface-variant">
            <span>Simulating…</span>
            <span>
              {done}/{total} jobs
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="text-right text-[11px] text-on-surface-variant/60">
            {progressPct.toFixed(0)}%
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {report && <RosterReportView report={report} />}
    </div>
  );
}
