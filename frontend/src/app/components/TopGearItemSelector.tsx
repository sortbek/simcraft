'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { API_URL } from '../lib/api';
import { useSimContext } from './SimContext';
import GearItemRow from './GearItemRow';

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
  { label: 'Head', slots: ['head'] },
  { label: 'Neck', slots: ['neck'] },
  { label: 'Shoulder', slots: ['shoulder'] },
  { label: 'Back', slots: ['back'] },
  { label: 'Chest', slots: ['chest'] },
  { label: 'Wrist', slots: ['wrist'] },
  { label: 'Hands', slots: ['hands'] },
  { label: 'Waist', slots: ['waist'] },
  { label: 'Legs', slots: ['legs'] },
  { label: 'Feet', slots: ['feet'] },
  { label: 'Rings', slots: ['finger1', 'finger2'] },
  { label: 'Trinkets', slots: ['trinket1', 'trinket2'] },
  { label: 'Main Hand', slots: ['main_hand'] },
  { label: 'Off Hand', slots: ['off_hand'] },
];

function getIconUrl(iconName: string): string {
  return `https://render.worldofwarcraft.com/icons/56/${iconName}.jpg`;
}

function getWowheadUrl(itemId: number): string {
  return `https://www.wowhead.com/item=${itemId}`;
}

function getWowheadData(item: ResolvedItem): string {
  const parts: string[] = [];
  if (item.bonus_ids.length > 0) parts.push(`bonus=${item.bonus_ids.join(':')}`);
  if (item.ilevel > 0) parts.push(`ilvl=${item.ilevel}`);
  if (item.enchant_id > 0) parts.push(`ench=${item.enchant_id}`);
  if (item.gem_id > 0) parts.push(`gems=${item.gem_id}`);
  return parts.join('&');
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
  const effectiveMaxCombinations = maxCombinations ?? 500;
  const [upgradeMenuFor, setUpgradeMenuFor] = useState<string | null>(null);
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeOption[]>([]);
  const [loadingUpgrades, setLoadingUpgrades] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(true);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setHeaderVisible(entry.isIntersecting), {
      threshold: 0,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useWowheadTooltips([resolved]);

  const openUpgradeMenu = useCallback(
    async (item: ResolvedItem, key: string) => {
      if (upgradeMenuFor === key) {
        setUpgradeMenuFor(null);
        return;
      }
      setUpgradeMenuFor(key);
      setLoadingUpgrades(true);
      try {
        const res = await fetch(
          `${API_URL}/api/upgrade-options?bonus_ids=${item.bonus_ids.join(',')}`
        );
        const data = await res.json();
        setUpgradeOptions(data.options || []);
      } catch {
        setUpgradeOptions([]);
      }
      setLoadingUpgrades(false);
    },
    [upgradeMenuFor]
  );

  const addUpgradedCopy = useCallback(
    (item: ResolvedItem, option: UpgradeOption) => {
      // Find the current upgrade bonus_id to replace
      const currentUpgradeBonusId = upgradeOptions.find((o) =>
        item.bonus_ids.includes(o.bonus_id)
      )?.bonus_id;
      if (!currentUpgradeBonusId) return;

      const newBonusIds = item.bonus_ids.map((b) =>
        b === currentUpgradeBonusId ? option.bonus_id : b
      );
      const newSimcString = item.simc_string.replace(
        /bonus_id=[0-9/:]+/,
        `bonus_id=${newBonusIds.join('/')}`
      );

      const copy: ResolvedItem = {
        ...item,
        uid: `${item.item_id}:${[...newBonusIds].sort((a, b) => a - b).join(':')}:${item.origin}:${item.slot}`,
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
    },
    [resolved, upgradeOptions, onResolvedChange, onItemAdded]
  );

  function toggleItem(item: ResolvedItem, group: DisplayGroup) {
    applyToggle(item, group, {
      ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
    });
  }

  function applyToggle(
    item: ResolvedItem,
    group: DisplayGroup,
    updated: Record<string, Set<string>>
  ) {
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
        const matching = slotRes.alternatives.find((a) => a.uid === item.uid);
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
    return group.slots.some((slot) => {
      const slotRes = resolved.slots[slot];
      if (!slotRes) return false;
      const matching = slotRes.alternatives.find((a) => a.uid === item.uid);
      return matching ? (selectedUids[slot]?.has(matching.uid) ?? false) : false;
    });
  }

  // Build visible groups from resolved data
  const visibleGroups = useMemo(() => {
    const result: {
      group: DisplayGroup;
      equipped: ResolvedItem[];
      alternatives: ResolvedItem[];
    }[] = [];
    for (const group of DISPLAY_GROUPS) {
      const equipped: ResolvedItem[] = [];
      const alternatives: ResolvedItem[] = [];
      const seenAltKeys = new Set<string>();

      for (const slot of group.slots) {
        const slotRes = resolved.slots[slot];
        if (!slotRes) continue;
        if (slotRes.equipped) equipped.push(slotRes.equipped);
        for (const alt of slotRes.alternatives) {
          const key = `${alt.item_id}:${[...alt.bonus_ids].sort().join(':')}`;
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

  function itemDetails(item: ResolvedItem): { text: string; color?: string }[] {
    const parts: { text: string; color?: string }[] = [];
    if (item.origin === 'vault') parts.push({ text: 'Great Vault', color: 'text-amber-400/80' });
    if (item.tag) parts.push({ text: item.tag });
    if (item.upgrade) parts.push({ text: item.upgrade });
    if (item.gem_name) {
      parts.push({ text: item.gem_name, color: 'text-sky-400/70' });
    } else if (item.sockets > 0) {
      parts.push({
        text: `${item.sockets > 1 ? item.sockets + ' ' : ''}Socket${item.sockets > 1 ? 's' : ''}`,
        color: 'text-sky-400/70',
      });
    }
    if (item.enchant_name) parts.push({ text: item.enchant_name, color: 'text-emerald-400/70' });
    return parts;
  }

  if (visibleGroups.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">
          No alternative items found. Make sure your SimC addon exports bag items.
        </p>
      </div>
    );
  }

  const comboLabel = `${comboCount.toLocaleString()} combo${comboCount !== 1 ? 's' : ''}`;
  const comboColorClass =
    comboCount > effectiveMaxCombinations
      ? 'bg-red-500/10 text-red-400'
      : comboCount > 0
        ? 'bg-surface-2 text-white'
        : 'bg-surface-2 text-muted';

  return (
    <div className="space-y-4">
      {!headerVisible && (
        <div className="fixed left-0 right-0 top-12 z-40 flex items-center justify-between border-b border-border/50 bg-surface/90 px-4 py-2 backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">Select Items</p>
          <span className={`rounded-md px-2.5 py-1 font-mono text-xs ${comboColorClass}`}>
            {comboLabel}
          </span>
        </div>
      )}
      <div ref={headerRef} className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">Select Items</p>
        <span className={`rounded-md px-2.5 py-1 font-mono text-xs ${comboColorClass}`}>
          {comboLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleGroups.map(({ group, equipped, alternatives }) => (
          <div key={group.label} className="card space-y-1 p-3.5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
              {group.label}
            </p>

            {equipped.map((item, eqIdx) => (
              <GearItemRow
                key={`eq-${eqIdx}`}
                icon={item.icon}
                name={item.name}
                nameColor={item.quality_color}
                details={itemDetails(item)}
                ilevel={item.ilevel}
                equipped
                href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
                wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
              >
                <UpgradeButton
                  item={item}
                  upgradeMenuFor={upgradeMenuFor}
                  upgradeOptions={upgradeOptions}
                  loadingUpgrades={loadingUpgrades}
                  onUpgradeClick={() => openUpgradeMenu(item, item.uid)}
                  onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)}
                />
              </GearItemRow>
            ))}

            {equipped.length > 0 && alternatives.length > 0 && (
              <div className="!my-1.5 border-t border-border/50" />
            )}

            {alternatives.map((item, altIdx) => (
              <GearItemRow
                key={`alt-${altIdx}`}
                icon={item.icon}
                name={item.name}
                nameColor={item.quality_color}
                details={itemDetails(item)}
                ilevel={item.ilevel}
                selectable
                checked={isItemSelected(item, group)}
                onToggle={() => toggleItem(item, group)}
                vault={item.origin === 'vault'}
                href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
                wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
              >
                <UpgradeButton
                  item={item}
                  upgradeMenuFor={upgradeMenuFor}
                  upgradeOptions={upgradeOptions}
                  loadingUpgrades={loadingUpgrades}
                  onUpgradeClick={() => openUpgradeMenu(item, item.uid)}
                  onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)}
                />
              </GearItemRow>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function UpgradeButton({
  item,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onUpgradeClick,
  onUpgradeSelect,
}: {
  item: ResolvedItem;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
}) {
  if (!item.upgrade) return null;
  const isMenuOpen = upgradeMenuFor === item.uid;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onUpgradeClick();
        }}
        className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
          isMenuOpen
            ? 'bg-gold/20 text-gold'
            : 'text-gray-600 hover:bg-white/[0.05] hover:text-gray-400'
        }`}
        title="Add copy at different upgrade level"
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M8 12V4M5 7l3-3 3 3" />
        </svg>
      </button>
      {isMenuOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-border bg-surface py-1 shadow-xl">
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
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onUpgradeSelect(opt);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] ${
                    isCurrent
                      ? 'cursor-default text-muted'
                      : 'text-gray-300 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <span>{opt.fullName}</span>
                  <span className="font-mono text-[10px] tabular-nums text-muted">
                    {opt.itemLevel}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
