'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { API_URL } from '../../lib/api';
import { ROUTES } from '../../lib/routes';
import { TRIAGE_BATCH_OPTIONS } from '../../lib/triageBatch';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import ExpertToggle, { EXPERT_TABS, type ExpertTabKey } from './ExpertToggle';
import RaidBuffsConsumables from './RaidBuffsConsumables';

const ITERATION_PRESETS = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** Nearest preset index at-or-below the value, so the slider can represent any stored value. */
function iterationSliderIndex(value: number): number {
  let idx = 0;
  for (let i = 0; i < ITERATION_PRESETS.length; i++) {
    if (value >= ITERATION_PRESETS[i]) idx = i;
  }
  return idx;
}

interface ConfigDrawerProps {
  children?: ReactNode;
  activeTab: 'simulation' | 'buffs';
  onActiveTabChange: (tab: 'simulation' | 'buffs') => void;
  expertActiveTab: ExpertTabKey;
  onExpertActiveTabChange: (tab: ExpertTabKey) => void;
  availableBranches: string[];
  onAvailableBranchesChange: (branches: string[]) => void;
}

export default function ConfigDrawer({
  children,
  activeTab,
  onActiveTabChange,
  expertActiveTab,
  onExpertActiveTabChange,
  availableBranches,
  onAvailableBranchesChange,
}: ConfigDrawerProps) {
  const { t } = useLanguage();
  const isTopGear = usePathname() === ROUTES.topGear;
  const {
    fightStyle,
    setFightStyle,
    targetCount,
    setTargetCount,
    fightLength,
    setFightLength,
    targetError,
    setTargetError,
    iterations,
    setIterations,
    customApl,
    setCustomApl,
    rotationMode,
    setRotationMode,
    simcHeader,
    setSimcHeader,
    simcBasePlayer,
    setSimcBasePlayer,
    simcRaidActors,
    setSimcRaidActors,
    simcPostCombos,
    setSimcPostCombos,
    simcFooter,
    setSimcFooter,
    simcBranch,
    setSimcBranch,
    parallelProfilesets,
    setParallelProfilesets,
    triageMaxBatchProfilesets,
    setTriageMaxBatchProfilesets,
  } = useSimContext();

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.listSimcVersions().then((result) => {
        const branches = [...new Set(result.versions.map((version) => version.type))];
        onAvailableBranchesChange(branches);
      });
    } else {
      fetch(`${API_URL}/api/branches`)
        .then((r) => r.json())
        .then((data) => {
          if (data.branches?.length) {
            onAvailableBranchesChange(data.branches);
          }
        })
        .catch(() => {});
    }
  }, [onAvailableBranchesChange]);

  const expertValues: Record<ExpertTabKey, string> = useMemo(
    () => ({
      header: simcHeader,
      base_player: simcBasePlayer,
      raid_actors: simcRaidActors,
      post_combos: simcPostCombos,
      footer: simcFooter,
    }),
    [simcHeader, simcBasePlayer, simcRaidActors, simcPostCombos, simcFooter]
  );

  const expertSetters: Record<ExpertTabKey, (value: string) => void> = useMemo(
    () => ({
      header: setSimcHeader,
      base_player: setSimcBasePlayer,
      raid_actors: setSimcRaidActors,
      post_combos: setSimcPostCombos,
      footer: setSimcFooter,
    }),
    [setSimcHeader, setSimcBasePlayer, setSimcRaidActors, setSimcPostCombos, setSimcFooter]
  );

  const hasExpertContent = Object.values(expertValues).some((value) => value.trim());
  const expertActiveTabInfo = EXPERT_TABS.find((tab) => tab.key === expertActiveTab)!;

  return (
    <div className="animate-fade-in border-t border-outline-variant/10 bg-[#0e0e0e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-screen-2xl px-8 py-5">
        <div className="mb-5 flex items-center gap-1">
          {[
            { key: 'simulation' as const, label: t('config.simulation') },
            {
              key: 'buffs' as const,
              label: `${t('config.raidBuffs')} & ${t('config.consumables')}`,
            },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onActiveTabChange(tab.key)}
              className={`rounded-lg px-4 py-2 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                activeTab === tab.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant/50 hover:bg-surface-container-high/50 hover:text-on-surface-variant'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'simulation' && (
          <div className="animate-fade-in space-y-6">
            <div className="grid grid-cols-4 gap-6">
              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {t('config.fightStyle')}
                </label>
                <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {t('config.fightLength')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={30}
                    max={1800}
                    step={30}
                    value={Math.min(fightLength, 1800)}
                    onChange={(event) => setFightLength(Number(event.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <div className="min-w-[4.5rem] rounded-lg border border-outline-variant/20 bg-surface-container-lowest text-center">
                    <input
                      type="number"
                      min={10}
                      max={3600}
                      value={fightLength}
                      onChange={(event) => {
                        const value = Math.max(10, Math.min(3600, Number(event.target.value) || 0));
                        setFightLength(value);
                      }}
                      className="w-16 bg-transparent px-1 py-1.5 text-center font-mono text-sm font-bold tabular-nums text-primary focus:outline-none"
                    />
                    <span className="pr-2 text-[9px] text-on-surface-variant/50">
                      {t('config.sec')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {t('config.numberOfBosses')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={targetCount}
                    onChange={(event) => setTargetCount(Number(event.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <div className="min-w-[4.5rem] rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-1.5 text-center">
                    <span className="font-mono text-sm font-bold tabular-nums text-primary">
                      {targetCount}
                    </span>
                    <span className="ml-1 text-[9px] text-on-surface-variant/50">
                      {targetCount === 1 ? t('config.boss') : t('config.bosses')}
                    </span>
                  </div>
                </div>
              </div>

              {availableBranches.length > 1 && (
                <div className="space-y-2">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                    SimC Branch
                  </label>
                  <div className="flex gap-1.5">
                    {availableBranches.map((branch) => {
                      const isActive =
                        simcBranch === branch || (!simcBranch && branch === 'weekly');
                      return (
                        <button
                          key={branch}
                          type="button"
                          onClick={() => setSimcBranch(branch)}
                          className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-bold uppercase transition-all ${
                            isActive
                              ? 'bg-primary-container text-on-primary'
                              : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          {branch}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {children && <div className="flex flex-wrap items-center gap-6">{children}</div>}

            <ScenarioBuilder />

            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                {t('config.rotationMode')}
              </label>
              <div className="flex gap-2">
                {(
                  [
                    { value: 'default', label: t('config.rotationModeDefault'), hint: null },
                    {
                      value: 'assisted_combat',
                      label: t('config.rotationModeAssisted'),
                      hint: t('config.rotationModeAssistedHint'),
                    },
                    {
                      value: 'one_button',
                      label: t('config.rotationModeOneButton'),
                      hint: t('config.rotationModeOneButtonHint'),
                    },
                  ] as const
                ).map((mode) => {
                  const isActive = rotationMode === mode.value;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setRotationMode(mode.value)}
                      className={`flex-1 rounded-lg px-3 py-2 text-center transition-all ${
                        isActive
                          ? 'bg-primary-container text-on-primary'
                          : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <div className="text-xs font-bold uppercase">{mode.label}</div>
                      {mode.hint && (
                        <div className="mt-0.5 text-[10px] font-normal normal-case opacity-70">
                          {mode.hint}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-on-surface-variant/40">
                {t('config.rotationModeDpsOnly')}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                {t('config.customAplSimcOptions')}
              </label>
              {rotationMode !== 'default' && (
                <div className="text-on-tertiary-container rounded-md bg-tertiary-container/40 px-3 py-2 text-[11px]">
                  {t('config.rotationModeAplWarning')}
                </div>
              )}
              <textarea
                value={customApl}
                onChange={(event) => setCustomApl(event.target.value)}
                placeholder={t('config.customAplPlaceholder')}
                className="input-field h-20 resize-y font-mono text-xs"
              />
            </div>

            <ExpertToggle
              hasContent={hasExpertContent}
              activeTab={expertActiveTab}
              setActiveTab={onExpertActiveTabChange}
              expertValues={expertValues}
              expertSetters={expertSetters}
              activeTabInfo={expertActiveTabInfo}
            >
              <div className="space-y-2 border-t border-outline-variant/10 pt-3">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {t('config.targetError')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0.01}
                    max={1.0}
                    step={0.01}
                    value={targetError}
                    onChange={(event) => setTargetError(Number(event.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <input
                    type="number"
                    min={0.01}
                    max={5}
                    step={0.01}
                    value={targetError}
                    onChange={(event) => {
                      const value = Math.max(0.01, Math.min(5, Number(event.target.value) || 0.05));
                      setTargetError(value);
                    }}
                    className="w-16 rounded border border-outline-variant/20 bg-surface-container-lowest px-1 py-1.5 text-center font-mono text-sm font-bold tabular-nums text-primary focus:outline-none"
                  />
                  <span className="text-[9px] text-on-surface-variant/50">%</span>
                </div>
                <p className="text-[11px] text-on-surface-variant/40">
                  Lower = more precise but slower. Default: 0.05%
                </p>
              </div>
              <div className="space-y-2 border-t border-outline-variant/10 pt-3">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {t('config.iterations')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={ITERATION_PRESETS.length - 1}
                    step={1}
                    value={iterationSliderIndex(iterations)}
                    onChange={(event) => setIterations(ITERATION_PRESETS[Number(event.target.value)])}
                    className="flex-1 accent-primary"
                  />
                  <input
                    type="number"
                    min={100}
                    max={1000000}
                    step={1000}
                    value={iterations}
                    onChange={(event) => {
                      const value = Math.max(100, Math.min(1000000, Number(event.target.value) || 0));
                      setIterations(value);
                    }}
                    className="w-20 rounded border border-outline-variant/20 bg-surface-container-lowest px-1 py-1.5 text-center font-mono text-sm font-bold tabular-nums text-primary focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-on-surface-variant/40">
                  {t('config.iterationsHelp')}
                </p>
              </div>
              <div className="space-y-2 border-t border-outline-variant/10 pt-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={parallelProfilesets}
                    onChange={(event) => setParallelProfilesets(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <div className="flex-1">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                      Parallel profileset scheduling
                    </div>
                    <p className="mt-1 text-[11px] text-on-surface-variant/40">
                      When enabled, SimHammer adds{' '}
                      <code className="font-mono text-on-surface-variant/70">
                        profileset_work_threads=1
                      </code>{' '}
                      to early Top Gear stages (4+ combos at target_error &gt; 0.2), running
                      profilesets concurrently instead of sequentially. Measured to be modestly
                      faster on those stages; disabled at tighter precision where iteration
                      parallelism wins. Uncheck to never emit the flag.
                    </p>
                  </div>
                </label>
              </div>
              {isTopGear && (
                <div className="space-y-2 border-t border-outline-variant/10 pt-3">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Triage maximum batch size
                  </label>
                  <select
                    value={triageMaxBatchProfilesets}
                    onChange={(event) => setTriageMaxBatchProfilesets(Number(event.target.value))}
                    className="w-full rounded border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-none"
                  >
                    {TRIAGE_BATCH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-on-surface-variant/40">
                    Streamed Top Gear only. Larger batches reduce repeated baseline and retention
                    overhead, but Pause waits until the current batch completes.
                  </p>
                </div>
              )}
            </ExpertToggle>
          </div>
        )}

        {activeTab === 'buffs' && (
          <div className="animate-fade-in">
            <RaidBuffsConsumables />
          </div>
        )}
      </div>
    </div>
  );
}
