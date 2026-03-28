'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSimContext } from './SimContext';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import TalentPicker from './TalentPicker';

function parseCharacterInfo(input: string) {
  if (!input) return null;
  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  if (!nameMatch) return null;
  // Save last character to localStorage for history page
  const realmMatch = input.match(/^server=(.+)$/m);
  if (nameMatch[2] && realmMatch?.[1]) {
    try {
      localStorage.setItem(
        'simhammer_last_character',
        JSON.stringify({ name: nameMatch[2], realm: realmMatch[1] })
      );
    } catch {}
  }
  return {
    className: nameMatch[1],
    name: nameMatch[2],
    spec: specMatch?.[1] || 'unknown',
  };
}

const EXPERT_TABS = [
  {
    key: 'header',
    label: 'Header',
    desc: 'Injected before the base actor. Use for global options and initial overrides.',
  },
  {
    key: 'base_player',
    label: 'Base Player',
    desc: 'Injected after the base actor definition. Use for custom APL (actions=...) or player-specific overrides.',
  },
  {
    key: 'raid_actors',
    label: 'Raid Actors',
    desc: 'Extremely experimental! Adds additional raid actors. Disables single_actor_batch when used.',
  },
  {
    key: 'post_combos',
    label: 'Post Combos',
    desc: 'Injected after all profileset combinations. Use for additional actors after gear combos.',
  },
  {
    key: 'footer',
    label: 'Footer',
    desc: 'Injected at the very end. Use for dungeon routes, fight overrides, or custom enemy configs.',
  },
] as const;

type ExpertTabKey = (typeof EXPERT_TABS)[number]['key'];

function AdvancedOptions() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpertTabKey>('footer');
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
  const isDefault =
    fightStyle === 'Patchwerk' &&
    targetCount === 1 &&
    fightLength === 300 &&
    !customApl &&
    !hasExpertContent;
  const activeTabInfo = EXPERT_TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className="h-4 w-4 text-zinc-500"
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
          <span className="text-sm font-medium text-zinc-300">Advanced Options</span>
          {!open && !isDefault && (
            <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold">
              Modified
            </span>
          )}
        </div>
        <svg
          className={`h-3.5 w-3.5 text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
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
        <div className="animate-fade-in space-y-5 border-t border-border px-5 pb-5">
          <div className="pt-4">
            <label className="label-text">Fight Style</label>
            <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="label-text">Number of Bosses</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={targetCount}
                  onChange={(e) => setTargetCount(Number(e.target.value))}
                  className="flex-1 accent-gold"
                />
                <span className="w-6 text-right font-mono text-sm tabular-nums text-white">
                  {targetCount}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="label-text">Fight Length</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={30}
                  max={600}
                  step={30}
                  value={fightLength}
                  onChange={(e) => setFightLength(Number(e.target.value))}
                  className="flex-1 accent-gold"
                />
                <span className="w-16 text-right font-mono text-sm tabular-nums text-white">
                  {Math.floor(fightLength / 60)}:{String(fightLength % 60).padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>

          <ScenarioBuilder />

          {/* Custom APL */}
          <div className="space-y-2">
            <label className="label-text">Custom APL / SimC Options</label>
            <textarea
              value={customApl}
              onChange={(e) => setCustomApl(e.target.value)}
              placeholder="Custom APL or expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list=1)..."
              className="input-field h-28 resize-y font-mono text-xs"
            />
            <p className="text-[11px] text-zinc-600">
              Override action priority lists or set expansion-specific options. Injected after the
              base actor.
            </p>
          </div>

          {/* Expert Mode */}
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

function ExpertToggle({
  hasContent,
  activeTab,
  setActiveTab,
  expertValues,
  expertSetters,
  activeTabInfo,
}: {
  hasContent: boolean;
  activeTab: ExpertTabKey;
  setActiveTab: (v: ExpertTabKey) => void;
  expertValues: Record<ExpertTabKey, string>;
  expertSetters: Record<ExpertTabKey, (v: string) => void>;
  activeTabInfo: (typeof EXPERT_TABS)[number];
}) {
  const [open, setOpen] = useState(hasContent);

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2.5">
        <div
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            open ? 'bg-gold' : 'border border-border bg-surface-2'
          }`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              open ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
            }`}
          />
        </div>
        <span className="text-sm font-medium text-zinc-300">Expert Mode</span>
        {!open && hasContent && (
          <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold">
            Modified
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3">
          <div className="flex gap-1 overflow-x-auto">
            {EXPERT_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : expertValues[tab.key].trim()
                      ? 'border-gold/30 bg-gold/[0.06] text-gold hover:border-gold/50'
                      : 'border-border bg-surface-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {tab.label}
                {expertValues[tab.key].trim() && activeTab !== tab.key && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-gold" />
                )}
              </button>
            ))}
          </div>
          <textarea
            value={expertValues[activeTab]}
            onChange={(e) => expertSetters[activeTab](e.target.value)}
            placeholder={`Paste ${activeTabInfo.label.toLowerCase()} SimC input here...`}
            className="input-field h-32 resize-y font-mono text-xs"
          />
          <p className="text-[11px] text-zinc-600">{activeTabInfo.desc}</p>
        </div>
      )}
    </div>
  );
}

export default function SimSharedConfig() {
  const pathname = usePathname();
  const { simcInput, setSimcInput } = useSimContext();

  const showConfig =
    pathname === '/quick-sim' ||
    pathname === '/top-gear' ||
    pathname === '/drop-finder' ||
    pathname === '/upgrade-compare';
  if (!showConfig) return null;

  const detectedInfo = parseCharacterInfo(simcInput);

  return (
    <div className="mb-6 space-y-4">
      <div className="card space-y-3 p-5">
        <label className="label-text">SimC Addon Export</label>
        <textarea
          value={simcInput}
          onChange={(e) => setSimcInput(e.target.value)}
          placeholder="Paste your SimC addon export here..."
          className="input-field h-40 resize-y font-mono text-[11px] leading-relaxed"
        />
        {detectedInfo && (
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3.5 py-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-gold/70" />
              <p className="text-xs font-medium text-zinc-300">
                {detectedInfo.name}
                <span className="ml-1.5 font-normal text-zinc-500">
                  {detectedInfo.spec} {detectedInfo.className}
                </span>
              </p>
            </div>
            <TalentPicker />
          </div>
        )}
      </div>
      <AdvancedOptions />
    </div>
  );
}
