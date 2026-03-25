"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolveGearResponse, ResolvedItem } from "../lib/types";
import { useWowheadTooltips } from "../lib/useWowheadTooltips";
import { API_URL } from "../lib/api";
import { useSimContext } from "./SimContext";

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

interface TopGearItemSelectorProps {
  resolved: ResolveGearResponse;
  selectedUids: Record<string, Set<string>>;
  onSelectionChange: (selected: Record<string, Set<string>>) => void;
  onResolvedChange: (resolved: ResolveGearResponse) => void;
  onItemAdded: (slot: string, simcString: string, origin: string) => void;
  maxUpgrade?: boolean;
  comboCount: number;
  comboError: string;
}

interface DisplayGroup {
  label: string;
  slots: string[];
}

const DISPLAY_GROUPS: DisplayGroup[] = [
  { label: "Head", slots: ["head"] },
  { label: "Neck", slots: ["neck"] },
  { label: "Shoulder", slots: ["shoulder"] },
  { label: "Back", slots: ["back"] },
  { label: "Chest", slots: ["chest"] },
  { label: "Wrist", slots: ["wrist"] },
  { label: "Hands", slots: ["hands"] },
  { label: "Waist", slots: ["waist"] },
  { label: "Legs", slots: ["legs"] },
  { label: "Feet", slots: ["feet"] },
  { label: "Rings", slots: ["finger1", "finger2"] },
  { label: "Trinkets", slots: ["trinket1", "trinket2"] },
  { label: "Main Hand", slots: ["main_hand"] },
  { label: "Off Hand", slots: ["off_hand"] },
];

function getIconUrl(iconName: string): string {
  return `https://render.worldofwarcraft.com/icons/56/${iconName}.jpg`;
}

function getWowheadUrl(itemId: number): string {
  return `https://www.wowhead.com/item=${itemId}`;
}

function getWowheadData(item: ResolvedItem): string {
  const parts: string[] = [];
  if (item.bonus_ids.length > 0) parts.push(`bonus=${item.bonus_ids.join(":")}`);
  if (item.ilevel > 0) parts.push(`ilvl=${item.ilevel}`);
  if (item.enchant_id > 0) parts.push(`ench=${item.enchant_id}`);
  if (item.gem_id > 0) parts.push(`gems=${item.gem_id}`);
  return parts.join("&");
}

export default function TopGearItemSelector({
  resolved,
  selectedUids,
  onSelectionChange,
  onResolvedChange,
  onItemAdded,
  maxUpgrade,
  comboCount,
  comboError,
}: TopGearItemSelectorProps) {
  const { maxCombinations } = useSimContext();
  const [upgradeMenuFor, setUpgradeMenuFor] = useState<string | null>(null);
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeOption[]>([]);
  const [loadingUpgrades, setLoadingUpgrades] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(true);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setHeaderVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useWowheadTooltips([resolved]);

  const openUpgradeMenu = useCallback(async (item: ResolvedItem, key: string) => {
    if (upgradeMenuFor === key) { setUpgradeMenuFor(null); return; }
    setUpgradeMenuFor(key);
    setLoadingUpgrades(true);
    try {
      const res = await fetch(`${API_URL}/api/upgrade-options?bonus_ids=${item.bonus_ids.join(",")}`);
      const data = await res.json();
      setUpgradeOptions(data.options || []);
    } catch { setUpgradeOptions([]); }
    setLoadingUpgrades(false);
  }, [upgradeMenuFor]);

  const addUpgradedCopy = useCallback((item: ResolvedItem, option: UpgradeOption) => {
    // Find the current upgrade bonus_id to replace
    const currentUpgradeBonusId = upgradeOptions.find(
      o => item.bonus_ids.includes(o.bonus_id)
    )?.bonus_id;
    if (!currentUpgradeBonusId) return;

    const newBonusIds = item.bonus_ids.map(b => b === currentUpgradeBonusId ? option.bonus_id : b);
    const newSimcString = item.simc_string.replace(
      /bonus_id=[0-9/:]+/,
      `bonus_id=${newBonusIds.join("/")}`
    );

    const copy: ResolvedItem = {
      ...item,
      uid: `${item.item_id}:${[...newBonusIds].sort((a,b)=>a-b).join(":")}:${item.origin}:${item.slot}`,
      bonus_ids: newBonusIds,
      simc_string: newSimcString,
      ilevel: option.itemLevel,
      upgrade: option.fullName,
    };

    // Add copy to the resolved data
    const updatedSlots = { ...resolved.slots };
    const slotRes = updatedSlots[item.slot];
    if (slotRes) {
      updatedSlots[item.slot] = {
        ...slotRes,
        alternatives: [...slotRes.alternatives, copy],
      };
    }
    onResolvedChange({ ...resolved, slots: updatedSlots });

    // Notify parent so the simc string gets appended on submit
    onItemAdded(item.slot, newSimcString, item.origin);

    setUpgradeMenuFor(null);
  }, [resolved, selectedUids, upgradeOptions, onResolvedChange, onSelectionChange, onItemAdded]);

  function toggleItem(item: ResolvedItem, group: DisplayGroup) {
    applyToggle(item, group, { ...Object.fromEntries(
      Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])
    )});
  }

  function applyToggle(item: ResolvedItem, group: DisplayGroup, updated: Record<string, Set<string>>) {
    if (group.slots.length === 1) {
      const slot = item.slot;
      if (!updated[slot]) updated[slot] = new Set();
      if (updated[slot].has(item.uid)) {
        updated[slot].delete(item.uid);
      } else {
        updated[slot].add(item.uid);
      }
    } else {
      // Paired slots (rings/trinkets): toggle in all slots where this item appears
      const isSelected = isItemSelected(item, group);
      for (const slot of group.slots) {
        const slotRes = resolved.slots[slot];
        if (!slotRes) continue;
        const matching = slotRes.alternatives.find(a => a.uid === item.uid);
        if (!matching) continue;
        if (!updated[slot]) updated[slot] = new Set();
        if (isSelected) {
          updated[slot].delete(matching.uid);
        } else {
          updated[slot].add(matching.uid);
        }
      }
    }
    onSelectionChange(updated);
  }

  function isItemSelected(item: ResolvedItem, group: DisplayGroup): boolean {
    if (group.slots.length === 1) {
      return selectedUids[item.slot]?.has(item.uid) ?? false;
    }
    return group.slots.some(slot => {
      const slotRes = resolved.slots[slot];
      if (!slotRes) return false;
      const matching = slotRes.alternatives.find(a => a.uid === item.uid);
      return matching ? (selectedUids[slot]?.has(matching.uid) ?? false) : false;
    });
  }

  // Build visible groups from resolved data
  const visibleGroups = useMemo(() => {
    const result: { group: DisplayGroup; equipped: ResolvedItem[]; alternatives: ResolvedItem[] }[] = [];
    for (const group of DISPLAY_GROUPS) {
      const equipped: ResolvedItem[] = [];
      const alternatives: ResolvedItem[] = [];
      const seenAltKeys = new Set<string>();

      for (const slot of group.slots) {
        const slotRes = resolved.slots[slot];
        if (!slotRes) continue;
        if (slotRes.equipped) equipped.push(slotRes.equipped);
        for (const alt of slotRes.alternatives) {
          const key = `${alt.item_id}:${[...alt.bonus_ids].sort().join(":")}`;
          if (seenAltKeys.has(key)) continue;
          seenAltKeys.add(key);
          alternatives.push(alt);
        }
      }

      if (equipped.length > 0 || alternatives.length > 0) {
        equipped.sort((a, b) => b.ilevel - a.ilevel);
        alternatives.sort((a, b) => b.ilevel - a.ilevel);
        result.push({ group, equipped, alternatives });
      }
    }
    return result;
  }, [resolved]);

  if (visibleGroups.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">
          No alternative items found. Make sure your SimC addon exports bag items.
        </p>
      </div>
    );
  }

  const comboLabel = `${comboCount.toLocaleString()} combo${comboCount !== 1 ? "s" : ""}`;
  const comboColorClass = comboCount > maxCombinations
    ? "bg-red-500/10 text-red-400"
    : comboCount > 0
    ? "bg-surface-2 text-white"
    : "bg-surface-2 text-muted";

  return (
    <div className="space-y-4">
      {!headerVisible && (
        <div className="fixed top-12 left-0 right-0 z-40 bg-surface/90 backdrop-blur-sm border-b border-border/50 px-4 py-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted uppercase tracking-widest">
            Select Items
          </p>
          <span className={`text-xs font-mono px-2.5 py-1 rounded-md ${comboColorClass}`}>
            {comboLabel}
          </span>
        </div>
      )}
      <div ref={headerRef} className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted uppercase tracking-widest">
          Select Items
        </p>
        <span className={`text-xs font-mono px-2.5 py-1 rounded-md ${comboColorClass}`}>
          {comboLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleGroups.map(({ group, equipped, alternatives }) => (
          <div key={group.label} className="card p-3.5 space-y-1">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">
              {group.label}
            </p>

            {equipped.map((item, eqIdx) => (
              <div
                key={`eq-${eqIdx}`}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-white/[0.03]"
              >
                <div className="w-5 h-5 rounded-[3px] bg-white/10 flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-white/40" viewBox="0 0 16 16" fill="none">
                    <path d="M12 5L6.5 10.5L4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="w-8 h-8 shrink-0 rounded overflow-hidden ring-1 ring-white/5">
                  <img src={getIconUrl(item.icon)} alt="" width={32} height={32} className="w-full h-full" loading="lazy" />
                </div>
                <ItemDetails item={item} upgradeMenuKey={item.uid} upgradeMenuFor={upgradeMenuFor} upgradeOptions={upgradeOptions} loadingUpgrades={loadingUpgrades} onUpgradeClick={() => openUpgradeMenu(item, item.uid)} onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)} />
              </div>
            ))}

            {equipped.length > 0 && alternatives.length > 0 && (
              <div className="border-t border-border/50 !my-1.5" />
            )}

            {alternatives.map((item, altIdx) => {
              const checked = isItemSelected(item, group);
              const isVault = item.origin === "vault";

              return (
                <label
                  key={`alt-${altIdx}`}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors group ${
                    checked
                      ? isVault ? "bg-amber-400/[0.12] ring-2 ring-amber-400/50" : "bg-gold/[0.07]"
                      : isVault ? "bg-amber-400/[0.04] ring-1 ring-amber-400/30 hover:ring-amber-400/50 hover:bg-amber-400/[0.08]" : "hover:bg-white/[0.02]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleItem(item, group)}
                    className="sr-only peer"
                  />
                  <div
                    className={`w-5 h-5 rounded-[3px] border transition-all shrink-0 flex items-center justify-center ${
                      checked ? "bg-gold border-gold" : "border-gray-600 group-hover:border-gray-500"
                    }`}
                  >
                    {checked && (
                      <svg className="w-3 h-3 text-black" viewBox="0 0 16 16" fill="none">
                        <path d="M12 5L6.5 10.5L4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div className={`w-8 h-8 shrink-0 rounded overflow-hidden ring-2 ${isVault ? "ring-amber-400/70" : "ring-white/5"}`}>
                    <img src={getIconUrl(item.icon)} alt="" width={32} height={32} className="w-full h-full" loading="lazy" />
                  </div>
                  <ItemDetails item={item} upgradeMenuKey={item.uid} upgradeMenuFor={upgradeMenuFor} upgradeOptions={upgradeOptions} loadingUpgrades={loadingUpgrades} onUpgradeClick={() => openUpgradeMenu(item, item.uid)} onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)} />
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemDetails({
  item,
  upgradeMenuKey,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onUpgradeClick,
  onUpgradeSelect,
}: {
  item: ResolvedItem;
  upgradeMenuKey: string;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
}) {
  const hasUpgrade = !!item.upgrade;
  const isMenuOpen = upgradeMenuFor === upgradeMenuKey;

  const parts: { text: string; color?: string }[] = [];
  if (item.origin === "vault") parts.push({ text: "Great Vault", color: "text-amber-400/80" });
  if (item.tag) parts.push({ text: item.tag });
  if (item.upgrade) parts.push({ text: item.upgrade });
  if (item.gem_name) {
    parts.push({ text: item.gem_name, color: "text-sky-400/70" });
  } else if (item.sockets > 0) {
    parts.push({ text: `${item.sockets > 1 ? item.sockets + " " : ""}Socket${item.sockets > 1 ? "s" : ""}`, color: "text-sky-400/70" });
  }
  if (item.enchant_name) parts.push({ text: item.enchant_name, color: "text-emerald-400/70" });

  return (
    <>
      <div className="flex-1 min-w-0 relative">
        <a
          href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
          data-wowhead={item.item_id > 0 ? getWowheadData(item) : undefined}
          className="text-[13px] leading-tight truncate block no-underline pointer-events-none"
          style={{ color: item.quality_color }}
        >
          {item.name}
        </a>
        {parts.length > 0 && (
          <span className="text-[11px] text-muted truncate block mt-0.5">
            {parts.map((p, i) => (
              <span key={i}>
                {i > 0 && <span className="opacity-40"> · </span>}
                <span className={p.color || ""}>{p.text}</span>
              </span>
            ))}
          </span>
        )}
        {isMenuOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[180px]">
            {loadingUpgrades ? (
              <div className="px-3 py-2 text-[11px] text-muted">Loading...</div>
            ) : upgradeOptions.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted">No options</div>
            ) : (
              upgradeOptions.map((opt) => {
                const isCurrent = item.bonus_ids.includes(opt.bonus_id);
                return (
                  <button
                    key={opt.bonus_id}
                    type="button"
                    disabled={isCurrent}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onUpgradeSelect(opt); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between gap-2 ${
                      isCurrent ? "text-muted cursor-default" : "text-gray-300 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <span>{opt.fullName}</span>
                    <span className="font-mono tabular-nums text-[10px] text-muted">{opt.itemLevel}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {hasUpgrade && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onUpgradeClick(); }}
            className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
              isMenuOpen ? "bg-gold/20 text-gold" : "text-gray-600 hover:text-gray-400 hover:bg-white/[0.05]"
            }`}
            title="Add copy at different upgrade level"
          >
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 12V4M5 7l3-3 3 3" />
            </svg>
          </button>
        )}
        <span className="text-xs font-mono tabular-nums text-muted">
          {item.ilevel > 0 && item.ilevel}
        </span>
      </div>
    </>
  );
}
