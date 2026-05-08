'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { API_URL } from '../../lib/api';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import ExpertToggle, { EXPERT_TABS, type ExpertTabKey } from './ExpertToggle';
import RaidBuffsConsumables from './RaidBuffsConsumables';

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
    simcBranch,
    setSimcBranch,
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
                {t('config.customAplSimcOptions')}
              </label>
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
