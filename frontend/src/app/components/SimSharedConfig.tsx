"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSimContext } from "./SimContext";
import FightStyleSelector from "./FightStyleSelector";
import TalentPicker from "./TalentPicker";

function parseCharacterInfo(input: string) {
  if (!input) return null;
  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  if (!nameMatch) return null;
  // Save last character to localStorage for history page
  const realmMatch = input.match(/^server=(.+)$/m);
  if (nameMatch[2] && realmMatch?.[1]) {
    try { localStorage.setItem("simhammer_last_character", JSON.stringify({ name: nameMatch[2], realm: realmMatch[1] })); } catch {}
  }
  return {
    className: nameMatch[1],
    name: nameMatch[2],
    spec: specMatch?.[1] || "unknown",
  };
}

const EXPERT_TABS = [
  {
    key: "header",
    label: "Header",
    desc: "Injected before the base actor. Use for global options and initial overrides.",
  },
  {
    key: "base_player",
    label: "Base Player",
    desc: "Injected after the base actor definition. Use for custom APL (actions=...) or player-specific overrides.",
  },
  {
    key: "raid_actors",
    label: "Raid Actors",
    desc: "Extremely experimental! Adds additional raid actors. Disables single_actor_batch when used.",
  },
  {
    key: "post_combos",
    label: "Post Combos",
    desc: "Injected after all profileset combinations. Use for additional actors after gear combos.",
  },
  {
    key: "footer",
    label: "Footer",
    desc: "Injected at the very end. Use for dungeon routes, fight overrides, or custom enemy configs.",
  },
] as const;

type ExpertTabKey = (typeof EXPERT_TABS)[number]["key"];

function AdvancedOptions() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpertTabKey>("footer");
  const {
    fightStyle, setFightStyle,
    targetCount, setTargetCount,
    fightLength, setFightLength,
    customApl, setCustomApl,
    simcHeader, setSimcHeader,
    simcBasePlayer, setSimcBasePlayer,
    simcRaidActors, setSimcRaidActors,
    simcPostCombos, setSimcPostCombos,
    simcFooter, setSimcFooter,
  } = useSimContext();

  const expertValues: Record<ExpertTabKey, string> = {
    header: simcHeader,
    base_player: simcBasePlayer,
    raid_actors: simcRaidActors,
    post_combos: simcPostCombos,
    footer: simcFooter,
  };

  const expertSetters: Record<ExpertTabKey, (v: string) => void> = {
    header: setSimcHeader,
    base_player: setSimcBasePlayer,
    raid_actors: setSimcRaidActors,
    post_combos: setSimcPostCombos,
    footer: setSimcFooter,
  };

  const hasExpertContent = Object.values(expertValues).some((v) => v.trim());
  const isDefault = fightStyle === "Patchwerk" && targetCount === 1 && fightLength === 300 && !customApl && !hasExpertContent;
  const activeTabInfo = EXPERT_TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-300">Advanced Options</span>
          {!open && !isDefault && (
            <span className="text-[11px] text-gold bg-gold/10 px-1.5 py-0.5 rounded">
              Modified
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-border">
          <div className="pt-4">
            <label className="label-text mb-2 block">Fight Style</label>
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
                <span className="text-sm font-mono text-white tabular-nums w-6 text-right">{targetCount}</span>
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
                <span className="text-sm font-mono text-white tabular-nums w-16 text-right">{Math.floor(fightLength / 60)}:{String(fightLength % 60).padStart(2, "0")}</span>
              </div>
            </div>
          </div>

          {/* Custom APL */}
          <div className="space-y-2">
            <label className="label-text">Custom APL / SimC Options</label>
            <textarea
              value={customApl}
              onChange={(e) => setCustomApl(e.target.value)}
              placeholder="Custom APL or expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list=1)..."
              className="input-field h-28 font-mono text-xs resize-y"
            />
            <p className="text-[11px] text-gray-600">
              Override action priority lists or set expansion-specific options. Injected after the base actor.
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
    <div className="pt-2 border-t border-border space-y-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2"
      >
        <div
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
            open ? "bg-gold" : "bg-surface-2 border border-border"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
              open ? "left-[18px] bg-black" : "left-0.5 bg-gray-500"
            }`}
          />
        </div>
        <span className="text-sm font-medium text-gray-300">Expert Mode</span>
        {!open && hasContent && (
          <span className="text-[11px] text-gold bg-gold/10 px-1.5 py-0.5 rounded">
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
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border whitespace-nowrap ${
                    activeTab === tab.key
                      ? "bg-white text-black border-white"
                      : expertValues[tab.key].trim()
                      ? "bg-gold/10 text-gold border-gold/30 hover:border-gold/50"
                      : "bg-surface-2 text-gray-400 border-border hover:border-gray-500 hover:text-white"
                  }`}
                >
                  {tab.label}
                  {expertValues[tab.key].trim() && activeTab !== tab.key && (
                    <span className="ml-1 w-1.5 h-1.5 rounded-full bg-gold inline-block" />
                  )}
                </button>
              ))}
            </div>
            <textarea
              value={expertValues[activeTab]}
              onChange={(e) => expertSetters[activeTab](e.target.value)}
              placeholder={`Paste ${activeTabInfo.label.toLowerCase()} SimC input here...`}
              className="input-field h-32 font-mono text-xs resize-y"
            />
            <p className="text-[11px] text-gray-600">
              {activeTabInfo.desc}
            </p>
          </div>
        )}
      </div>
  );
}

export default function SimSharedConfig() {
  const pathname = usePathname();
  const { simcInput, setSimcInput } = useSimContext();

  const showConfig = pathname === "/quick-sim" || pathname === "/top-gear" || pathname === "/drop-finder";
  if (!showConfig) return null;

  const detectedInfo = parseCharacterInfo(simcInput);

  return (
    <div className="space-y-6 mb-6">
      <div className="card p-5 space-y-3">
        <label className="label-text">SimC Addon Export</label>
        <textarea
          value={simcInput}
          onChange={(e) => setSimcInput(e.target.value)}
          placeholder="Paste your SimC addon export here..."
          className="input-field h-44 font-mono text-xs resize-y"
        />
        {detectedInfo && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gold">
              {detectedInfo.name} &middot; {detectedInfo.spec}{" "}
              {detectedInfo.className}
            </p>
            <TalentPicker />
          </div>
        )}
      </div>
      <AdvancedOptions />
    </div>
  );
}
