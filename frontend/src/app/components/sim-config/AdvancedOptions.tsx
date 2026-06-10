'use client';

import { useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
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

export default function AdvancedOptions() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpertTabKey>('footer');
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
  } = useSimContext();

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

  const expertSetters: Record<ExpertTabKey, (v: string) => void> = useMemo(
    () => ({
      header: setSimcHeader,
      base_player: setSimcBasePlayer,
      raid_actors: setSimcRaidActors,
      post_combos: setSimcPostCombos,
      footer: setSimcFooter,
    }),
    [setSimcHeader, setSimcBasePlayer, setSimcRaidActors, setSimcPostCombos, setSimcFooter]
  );

  const hasExpertContent = Object.values(expertValues).some((v) => v.trim());
  const isDefault =
    fightStyle === 'Patchwerk' &&
    targetCount === 1 &&
    fightLength === 300 &&
    targetError === 0.1 &&
    iterations === 100000 &&
    !customApl &&
    !hasExpertContent;
  const activeTabInfo = EXPERT_TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-surface-container-high"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className="h-4 w-4 text-on-surface-variant/60"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
          </svg>
          <span className="text-sm font-medium text-on-surface-variant">
            {t('config.advancedOptions')}
          </span>
          {!open && !isDefault && (
            <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium text-gold">
              {t('config.modified')}
            </span>
          )}
        </div>
        <svg
          className={`h-3.5 w-3.5 text-on-surface-variant/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="animate-fade-in space-y-5 border-t border-outline-variant/10 px-5 pb-5">
          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="space-y-2">
              <label className="label-text">{t('config.fightStyle')}</label>
              <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
            </div>
            <div className="space-y-2">
              <label className="label-text">{t('config.fightLength')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={30}
                  max={1800}
                  step={30}
                  value={Math.min(fightLength, 1800)}
                  onChange={(e) => setFightLength(Number(e.target.value))}
                  className="flex-1 accent-gold"
                />
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={fightLength}
                  onChange={(e) => {
                    const v = Math.max(10, Math.min(3600, Number(e.target.value) || 0));
                    setFightLength(v);
                  }}
                  className="w-16 rounded bg-transparent px-1 py-0.5 text-right font-mono text-sm tabular-nums text-on-surface focus:outline-none focus:ring-1 focus:ring-gold/30"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="label-text">{t('config.numberOfBosses')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={targetCount}
                  onChange={(e) => setTargetCount(Number(e.target.value))}
                  className="flex-1 accent-gold"
                />
                <span className="w-6 text-right font-mono text-sm tabular-nums text-on-surface">
                  {targetCount}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="label-text">{t('config.targetError')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  value={targetError}
                  onChange={(e) => setTargetError(Number(e.target.value))}
                  className="flex-1 accent-gold"
                />
                <span className="w-12 text-right font-mono text-sm tabular-nums text-on-surface">
                  {targetError}%
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="label-text">{t('config.iterations')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={ITERATION_PRESETS.length - 1}
                  step={1}
                  value={iterationSliderIndex(iterations)}
                  onChange={(e) => setIterations(ITERATION_PRESETS[Number(e.target.value)])}
                  className="flex-1 accent-gold"
                />
                <input
                  type="number"
                  min={100}
                  max={1000000}
                  value={iterations}
                  onChange={(e) => {
                    const v = Math.max(100, Math.min(1000000, Number(e.target.value) || 0));
                    setIterations(v);
                  }}
                  className="w-20 rounded bg-transparent px-1 py-0.5 text-right font-mono text-sm tabular-nums text-on-surface focus:outline-none focus:ring-1 focus:ring-gold/30"
                />
              </div>
              <p className="text-[13px] text-on-surface-variant/40">{t('config.iterationsHelp')}</p>
            </div>
          </div>

          <RaidBuffsConsumables />

          <ScenarioBuilder />

          <div className="space-y-2">
            <label className="label-text">{t('config.customAplSimcOptions')}</label>
            <textarea
              value={customApl}
              onChange={(e) => setCustomApl(e.target.value)}
              placeholder={t('config.customAplPlaceholder')}
              className="input-field h-28 resize-y font-mono text-xs"
            />
            <p className="text-[13px] text-on-surface-variant/40">{t('config.customAplHelp')}</p>
          </div>

          <ExpertToggle
            hasContent={hasExpertContent}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            expertValues={expertValues}
            expertSetters={expertSetters}
            activeTabInfo={activeTabInfo}
          />
        </div>
      )}
    </div>
  );
}
