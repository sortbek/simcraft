'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import { ROUTES } from '../../lib/routes';
import { TRIAGE_BATCH_OPTIONS } from '../../lib/triageBatch';
import ExpertToggle, { EXPERT_TABS, type ExpertTabKey } from './ExpertToggle';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';
import { HELP, VALUE, VALUE_INPUT, rangeFill } from './settingsUi';

const ITERATION_PRESETS = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** Nearest preset index at-or-below the value, so the slider can represent any stored value. */
function iterationSliderIndex(value: number): number {
  let idx = 0;
  for (let i = 0; i < ITERATION_PRESETS.length; i++) {
    if (value >= ITERATION_PRESETS[i]) idx = i;
  }
  return idx;
}

/** The fold-out under the Sim settings columns: SimC branch, precision,
 *  profileset scheduling, custom APL and the expert-mode input tabs. */
export default function AdvancedSettings() {
  const { t } = useLanguage();
  const isTopGear = usePathname() === ROUTES.topGear;
  const {
    targetError,
    setTargetError,
    iterations,
    setIterations,
    customApl,
    setCustomApl,
    rotationMode,
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
  const [branches, setBranches] = useState<string[]>([]);
  const [expertTab, setExpertTab] = useState<ExpertTabKey>('footer');

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.listSimcVersions().then((result) => {
        setBranches([...new Set(result.versions.map((version) => version.type))]);
      });
    } else {
      fetchJsonOr<{ branches?: string[] }>(apiUrl('/api/branches'), {}).then((data) => {
        if (data.branches?.length) setBranches(data.branches);
      });
    }
  }, []);

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

  return (
    <div className="sim-adv-grid">
      {branches.length > 1 && (
        <div className="space-y-2">
          <label className="lbl block">SimC Branch</label>
          <div className={`${TABS_TRACK} !flex`}>
            {branches.map((branch) => {
              const isActive = simcBranch === branch || (!simcBranch && branch === 'weekly');
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

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="lbl block">{t('config.targetError')}</label>
          <div className="flex items-baseline gap-1">
            <input
              type="number"
              min={0.01}
              max={5}
              step={0.01}
              value={targetError}
              onChange={(event) =>
                setTargetError(Math.max(0.01, Math.min(5, Number(event.target.value) || 0.05)))
              }
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

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="lbl block">{t('config.iterations')}</label>
          <input
            type="number"
            min={100}
            max={1000000}
            step={1000}
            value={iterations}
            onChange={(event) =>
              setIterations(Math.max(100, Math.min(1000000, Number(event.target.value) || 0)))
            }
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
          style={rangeFill(iterationSliderIndex(iterations), 0, ITERATION_PRESETS.length - 1)}
          className="range"
        />
        <p className={HELP}>{t('config.iterationsHelp')}</p>
      </div>

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
            <code className="font-mono text-on-surface-variant">profileset_work_threads=1</code>{' '}
            {t('config.parallelProfilesetsHelpAfter')}
          </p>
        </div>
      </label>

      {isTopGear && (
        <div className="space-y-2">
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

      <div className="sim-adv-wide space-y-2">
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

      <div className="sim-adv-wide space-y-2">
        <label className="lbl block">{t('config.expertMode')}</label>
        <ExpertToggle
          embedded
          hasContent={hasExpertContent}
          activeTab={expertTab}
          setActiveTab={setExpertTab}
          expertValues={expertValues}
          expertSetters={expertSetters}
          activeTabInfo={EXPERT_TABS.find((tab) => tab.key === expertTab)!}
        />
      </div>
    </div>
  );
}
