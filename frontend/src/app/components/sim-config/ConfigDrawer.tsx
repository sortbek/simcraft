'use client';

import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { API_URL, apiUrl, fetchJsonOr } from '../../lib/api';
import { ROUTES } from '../../lib/routes';
import { TRIAGE_BATCH_OPTIONS } from '../../lib/triageBatch';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import ExpertToggle, { EXPERT_TABS, type ExpertTabKey } from './ExpertToggle';
import RaidBuffsConsumables from './RaidBuffsConsumables';
import ActiveRouteIndicator from './ActiveRouteIndicator';
import ProfileControls from './ProfileControls';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';

const ITERATION_PRESETS = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** Nearest preset index at-or-below the value, so the slider can represent any stored value. */
function iterationSliderIndex(value: number): number {
  let idx = 0;
  for (let i = 0; i < ITERATION_PRESETS.length; i++) {
    if (value >= ITERATION_PRESETS[i]) idx = i;
  }
  return idx;
}

/** Fill position for the `.range` track, passed as `--v`. */
function rangeFill(value: number, min: number, max: number) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return { '--v': `${pct}%` } as CSSProperties;
}

const VALUE = 'font-headline text-[12.5px] font-extrabold text-on-surface';
const VALUE_INPUT = `bg-transparent text-right tabular-nums focus:outline-none ${VALUE}`;
const HELP = 'text-xs text-outline';

interface ConfigDrawerProps {
  children?: ReactNode;
  activeTab: 'simulation' | 'buffs' | 'expert';
  onActiveTabChange: (tab: 'simulation' | 'buffs' | 'expert') => void;
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
    isDungeonRoute,
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
      fetchJsonOr<{ branches?: string[] }>(apiUrl('/api/branches'), {}).then((data) => {
        if (data.branches?.length) {
          onAvailableBranchesChange(data.branches);
        }
      });
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
    <div className="animate-fade-in border-t border-line/[0.06] bg-surface-container-lowest/95 backdrop-blur-xl">
      <div className="mx-auto max-w-screen-2xl px-8 py-5">
        {/* Wraps rather than compressing: the tab labels and the six profile
            buttons together overflow a narrow window in the longer locales. */}
        <div className="mb-5 flex flex-wrap items-center gap-1">
          <div className={TABS_TRACK}>
            {[
              { key: 'simulation' as const, label: t('config.simulation'), modified: false },
              {
                key: 'buffs' as const,
                label: `${t('config.raidBuffs')} & ${t('config.consumables')}`,
                modified: false,
              },
              { key: 'expert' as const, label: t('config.expertMode'), modified: hasExpertContent },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onActiveTabChange(tab.key)}
                aria-pressed={activeTab === tab.key}
                className={tabClass(activeTab === tab.key)}
              >
                {tab.label}
                {tab.modified && activeTab !== tab.key && (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-fill align-middle" />
                )}
              </button>
            ))}
          </div>
          {/* Grows to push the controls right, but may collapse to 0 so the
              longer locales wrap the profile buttons instead of squeezing them. */}
          <div className="min-w-0 flex-1" />
          <ProfileControls />
        </div>

        {activeTab === 'simulation' && (
          <div className="animate-fade-in space-y-6">
            <ActiveRouteIndicator />
            <div className="grid grid-cols-4 gap-6">
              <div className="space-y-2">
                <label className="lbl block">{t('config.fightStyle')}</label>
                <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
              </div>

              {/* Fight Length and Number of Bosses are overridden by a dungeon
                  route, so hide them in Dungeon Route mode. */}
              {!isDungeonRoute && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="lbl block">{t('config.fightLength')}</label>
                    <div className="flex items-baseline gap-1">
                      <input
                        type="number"
                        min={10}
                        max={3600}
                        value={fightLength}
                        onChange={(event) => {
                          const value = Math.max(
                            10,
                            Math.min(3600, Number(event.target.value) || 0)
                          );
                          setFightLength(value);
                        }}
                        className={`w-14 ${VALUE_INPUT}`}
                      />
                      <span className={VALUE}>{t('config.sec')}</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={1800}
                    step={30}
                    value={Math.min(fightLength, 1800)}
                    onChange={(event) => setFightLength(Number(event.target.value))}
                    style={rangeFill(fightLength, 30, 1800)}
                    className="range"
                  />
                </div>
              )}

              {!isDungeonRoute && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="lbl block">{t('config.numberOfBosses')}</label>
                    <span className={`tabular-nums ${VALUE}`}>
                      {targetCount} {targetCount === 1 ? t('config.boss') : t('config.bosses')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={targetCount}
                    onChange={(event) => setTargetCount(Number(event.target.value))}
                    style={rangeFill(targetCount, 1, 10)}
                    className="range"
                  />
                </div>
              )}

              {availableBranches.length > 1 && (
                <div className="space-y-2">
                  <label className="lbl block">SimC Branch</label>
                  <div className={`${TABS_TRACK} !flex`}>
                    {availableBranches.map((branch) => {
                      const isActive =
                        simcBranch === branch || (!simcBranch && branch === 'weekly');
                      return (
                        <button
                          key={branch}
                          type="button"
                          onClick={() => setSimcBranch(branch)}
                          aria-pressed={isActive}
                          className={`flex-1 ${tabClass(isActive)}`}
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
              <label className="lbl block">{t('config.rotationMode')}</label>
              <div className={`${TABS_TRACK} !flex`}>
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
                      aria-pressed={isActive}
                      className={`flex-1 ${tabClass(isActive)} !h-auto min-h-7 py-1.5`}
                    >
                      <div>{mode.label}</div>
                      {mode.hint && (
                        <div className="mt-0.5 font-sans text-[11px] font-medium normal-case tracking-normal opacity-70">
                          {mode.hint}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className={HELP}>{t('config.rotationModeDpsOnly')}</p>
            </div>

            <div className="space-y-2">
              <label className="lbl block">{t('config.customAplSimcOptions')}</label>
              {rotationMode !== 'default' && (
                <div className="rounded-[6px] border border-gold/35 bg-gold/10 px-3 py-2 text-xs text-gold">
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
          </div>
        )}

        {activeTab === 'expert' && (
          <div className="animate-fade-in">
            <ExpertToggle
              embedded
              hasContent={hasExpertContent}
              activeTab={expertActiveTab}
              setActiveTab={onExpertActiveTabChange}
              expertValues={expertValues}
              expertSetters={expertSetters}
              activeTabInfo={expertActiveTabInfo}
            >
              <div className="space-y-2 border-t border-line/[0.06] pt-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="lbl block">{t('config.targetError')}</label>
                  <div className="flex items-baseline gap-1">
                    <input
                      type="number"
                      min={0.01}
                      max={5}
                      step={0.01}
                      value={targetError}
                      onChange={(event) => {
                        const value = Math.max(
                          0.01,
                          Math.min(5, Number(event.target.value) || 0.05)
                        );
                        setTargetError(value);
                      }}
                      className={`w-14 ${VALUE_INPUT}`}
                    />
                    <span className={VALUE}>%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={1.0}
                  step={0.01}
                  value={targetError}
                  onChange={(event) => setTargetError(Number(event.target.value))}
                  style={rangeFill(targetError, 0.01, 1)}
                  className="range"
                />
                <p className={HELP}>{t('config.targetErrorHelp')}</p>
              </div>
              <div className="space-y-2 border-t border-line/[0.06] pt-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="lbl block">{t('config.iterations')}</label>
                  <input
                    type="number"
                    min={100}
                    max={1000000}
                    step={1000}
                    value={iterations}
                    onChange={(event) => {
                      const value = Math.max(
                        100,
                        Math.min(1000000, Number(event.target.value) || 0)
                      );
                      setIterations(value);
                    }}
                    className={`w-24 ${VALUE_INPUT}`}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={ITERATION_PRESETS.length - 1}
                  step={1}
                  value={iterationSliderIndex(iterations)}
                  onChange={(event) => setIterations(ITERATION_PRESETS[Number(event.target.value)])}
                  style={rangeFill(
                    iterationSliderIndex(iterations),
                    0,
                    ITERATION_PRESETS.length - 1
                  )}
                  className="range"
                />
                <p className={HELP}>{t('config.iterationsHelp')}</p>
              </div>
              <div className="space-y-2 border-t border-line/[0.06] pt-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={parallelProfilesets}
                    onChange={(event) => setParallelProfilesets(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-gold-fill"
                  />
                  <div className="flex-1">
                    <div className="lbl">{t('config.parallelProfilesets')}</div>
                    <p className={`mt-1.5 ${HELP}`}>
                      {t('config.parallelProfilesetsHelpBefore')}{' '}
                      <code className="font-mono text-on-surface-variant">
                        profileset_work_threads=1
                      </code>{' '}
                      {t('config.parallelProfilesetsHelpAfter')}
                    </p>
                  </div>
                </label>
              </div>
              {isTopGear && (
                <div className="space-y-2 border-t border-line/[0.06] pt-3">
                  <label className="lbl block">{t('config.triageMaxBatch')}</label>
                  <select
                    value={triageMaxBatchProfilesets}
                    onChange={(event) => setTriageMaxBatchProfilesets(Number(event.target.value))}
                    className="sel"
                  >
                    {TRIAGE_BATCH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className={HELP}>{t('config.triageMaxBatchHelp')}</p>
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
