'use client';

import { useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import ExpertToggle, { EXPERT_TABS, type ExpertTabKey } from './ExpertToggle';

interface ConfigFooterProps {
  /** Page-specific toggles rendered in the drawer */
  children?: React.ReactNode;
  /** Submit handler */
  onSubmit: () => void;
  /** Whether the sim is currently submitting */
  submitting: boolean;
  /** Label for the submit button */
  buttonLabel: string;
  /** Whether the submit button should be disabled */
  disabled?: boolean;
}

export default function ConfigFooter({
  children,
  onSubmit,
  submitting,
  buttonLabel,
  disabled,
}: ConfigFooterProps) {
  const { t } = useLanguage();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expertActiveTab, setExpertActiveTab] = useState<ExpertTabKey>('footer');
  const {
    fightStyle,
    setFightStyle,
    targetCount,
    setTargetCount,
    fightLength,
    setFightLength,
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
  const expertActiveTabInfo = EXPERT_TABS.find((t) => t.key === expertActiveTab)!;

  const fightLengthLabel = `${Math.floor(fightLength / 60)}:${String(fightLength % 60).padStart(2, '0')}`;

  return (
    <div className="fixed bottom-0 left-64 right-0 z-30">
      {/* Expand-up drawer */}
      {drawerOpen && (
        <div className="border-t border-outline-variant/10 bg-[#0e0e0e]/95 backdrop-blur-xl animate-fade-in">
          <div className="mx-auto max-w-screen-2xl px-8 py-6 space-y-6">
            {/* Header with reset */}
            <div className="flex items-center justify-between">
              <span className="font-headline font-black text-sm uppercase tracking-widest text-on-surface-variant">
                {t('config.simulationOptions')}
              </span>
              <button
                type="button"
                onClick={() => {
                  setFightStyle('Patchwerk');
                  setFightLength(300);
                  setTargetCount(1);
                  setCustomApl('');
                  setSimcHeader('');
                  setSimcBasePlayer('');
                  setSimcRaidActors('');
                  setSimcPostCombos('');
                  setSimcFooter('');
                }}
                className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50 hover:text-error transition-colors"
              >
                {t('config.resetToDefaults')}
              </button>
            </div>
            {/* Row 1: Fight config */}
            <div className="grid grid-cols-3 gap-6">
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
                    max={600}
                    step={30}
                    value={fightLength}
                    onChange={(e) => setFightLength(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-lg px-3 py-1.5 min-w-[4.5rem] text-center">
                    <span className="font-mono text-primary text-sm font-bold tabular-nums">{fightLengthLabel}</span>
                    <span className="text-[9px] text-on-surface-variant/50 ml-1">{t('config.sec')}</span>
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
                    onChange={(e) => setTargetCount(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-lg px-3 py-1.5 min-w-[4.5rem] text-center">
                    <span className="font-mono text-primary text-sm font-bold tabular-nums">{targetCount}</span>
                    <span className="text-[9px] text-on-surface-variant/50 ml-1">{targetCount === 1 ? t('config.boss') : t('config.bosses')}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: Page-specific toggles */}
            {children && <div className="flex flex-wrap items-center gap-6">{children}</div>}

            {/* Row 3: Scenarios */}
            <ScenarioBuilder />

            {/* Row 4: Custom APL */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                {t('config.customAplSimcOptions')}
              </label>
              <textarea
                value={customApl}
                onChange={(e) => setCustomApl(e.target.value)}
                placeholder={t('config.customAplPlaceholder')}
                className="input-field h-20 resize-y font-mono text-xs"
              />
            </div>

            {/* Row 5: Expert */}
            <ExpertToggle
              hasContent={hasExpertContent}
              activeTab={expertActiveTab}
              setActiveTab={setExpertActiveTab}
              expertValues={expertValues}
              expertSetters={expertSetters}
              activeTabInfo={expertActiveTabInfo}
            />
          </div>
        </div>
      )}

      {/* Footer bar */}
      <div className="border-t border-outline-variant/10 bg-[#131313]/95 backdrop-blur-xl shadow-[0_-4px_20px_rgba(0,0,0,0.4)]">
        <div className="mx-auto max-w-screen-2xl px-8 flex items-center gap-6 h-20">
          {/* Config summary */}
          <div className="flex items-center gap-4 text-sm text-on-surface-variant">
            <span className="font-headline font-bold uppercase">{fightStyle}</span>
            <span className="h-4 w-px bg-outline-variant/30" />
            <span className="font-mono tabular-nums">{fightLengthLabel}</span>
            <span className="h-4 w-px bg-outline-variant/30" />
            <span className="font-mono tabular-nums">
              {targetCount} {targetCount === 1 ? t('config.boss') : t('config.bosses')}
            </span>
          </div>

          <div className="flex-1" />

          {/* Config gear button */}
          <button
            type="button"
            onClick={() => setDrawerOpen(!drawerOpen)}
            className={`flex items-center gap-2 rounded-lg px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
              drawerOpen
                ? 'bg-primary/10 text-primary'
                : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high'
            }`}
          >
            <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
            </svg>
            {drawerOpen ? t('common.close') : t('common.options')}
          </button>

          {/* Run button */}
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || submitting}
            className="bg-gradient-to-r from-primary to-primary-container px-12 py-4 rounded-lg text-on-primary font-headline font-black text-sm uppercase tracking-widest shadow-[0_4px_20px_rgba(200,153,42,0.3)] hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-3"
          >
            {submitting ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t('config.running')}
              </>
            ) : (
              buttonLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
