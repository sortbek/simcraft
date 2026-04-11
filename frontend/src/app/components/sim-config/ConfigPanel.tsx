'use client';

import { useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import ExpertToggle, { EXPERT_TABS, type ExpertTabKey } from './ExpertToggle';
import RaidBuffsConsumables from './RaidBuffsConsumables';

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
  const [activeTab, setActiveTab] = useState<'simulation' | 'buffs'>('simulation');
  const [expertActiveTab, setExpertActiveTab] = useState<ExpertTabKey>('footer');
  const {
    fightStyle,
    setFightStyle,
    targetCount,
    setTargetCount,
    fightLength,
    setFightLength,
    targetError,
    setTargetError,
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
          <div className="mx-auto max-w-screen-2xl px-8 py-5">
            {/* Tab bar */}
            <div className="flex items-center gap-1 mb-5">
              {([
                { key: 'simulation' as const, label: t('config.simulation') },
                { key: 'buffs' as const, label: t('config.raidBuffs') + ' & ' + t('config.consumables') },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-lg px-4 py-2 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                    activeTab === tab.key
                      ? 'bg-primary/10 text-primary'
                      : 'text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container-high/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab: Simulation */}
            {activeTab === 'simulation' && (
              <div className="space-y-6 animate-fade-in">
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
                        onChange={(e) => setFightLength(Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-lg min-w-[4.5rem] text-center">
                        <input
                          type="number"
                          min={10}
                          max={3600}
                          value={fightLength}
                          onChange={(e) => {
                            const v = Math.max(10, Math.min(3600, Number(e.target.value) || 0));
                            setFightLength(v);
                          }}
                          className="w-16 bg-transparent px-1 py-1.5 text-center font-mono text-primary text-sm font-bold tabular-nums focus:outline-none"
                        />
                        <span className="text-[9px] text-on-surface-variant/50 pr-2">{t('config.sec')}</span>
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

                {children && <div className="flex flex-wrap items-center gap-6">{children}</div>}

                <ScenarioBuilder />

                {/* Custom APL & Expert */}
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

                <ExpertToggle
                  hasContent={hasExpertContent}
                  activeTab={expertActiveTab}
                  setActiveTab={setExpertActiveTab}
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
                        onChange={(e) => setTargetError(Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <input
                        type="number"
                        min={0.01}
                        max={5}
                        step={0.01}
                        value={targetError}
                        onChange={(e) => {
                          const v = Math.max(0.01, Math.min(5, Number(e.target.value) || 0.05));
                          setTargetError(v);
                        }}
                        className="w-16 bg-transparent text-center font-mono text-primary text-sm font-bold tabular-nums focus:outline-none rounded px-1 py-1.5 bg-surface-container-lowest border border-outline-variant/20"
                      />
                      <span className="text-[9px] text-on-surface-variant/50">%</span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant/40">Lower = more precise but slower. Default: 0.05%</p>
                  </div>
                </ExpertToggle>
              </div>
            )}

            {/* Tab: Buffs & Consumables */}
            {activeTab === 'buffs' && (
              <div className="animate-fade-in">
                <RaidBuffsConsumables />
              </div>
            )}
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
