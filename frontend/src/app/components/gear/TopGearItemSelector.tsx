'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import type { ResolveGearResponse, ResolvedItem } from '../../lib/types';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import GearItemRow from './GearItemRow';
import { useSimContext } from '../sim-config/SimContext';
import { useLanguage } from '../../lib/i18n';
import { localizedItemName, localizedUpgrade, useItemNames, getWowheadUrl } from '../../lib/useItemInfo';

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
  { label: 'slot.head', slots: ['head'] },
  { label: 'slot.neck', slots: ['neck'] },
  { label: 'slot.shoulder', slots: ['shoulder'] },
  { label: 'slot.back', slots: ['back'] },
  { label: 'slot.chest', slots: ['chest'] },
  { label: 'slot.wrist', slots: ['wrist'] },
  { label: 'slot.hands', slots: ['hands'] },
  { label: 'slot.waist', slots: ['waist'] },
  { label: 'slot.legs', slots: ['legs'] },
  { label: 'slot.feet', slots: ['feet'] },
  { label: 'slot.rings', slots: ['finger1', 'finger2'] },
  { label: 'slot.trinkets', slots: ['trinket1', 'trinket2'] },
  { label: 'slot.mainHand', slots: ['main_hand'] },
  { label: 'slot.offHand', slots: ['off_hand'] },
];

function getIconUrl(iconName: string): string {
  return `https://render.worldofwarcraft.com/icons/56/${iconName}.jpg`;
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
  const { t, locale } = useLanguage();
  useItemNames();
  const { maxCombinations } = useSimContext();
  const effectiveMaxCombinations = maxCombinations ?? 500;
  const [upgradeMenuFor, setUpgradeMenuFor] = useState<string | null>(null);
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeOption[]>([]);
  const [loadingUpgrades, setLoadingUpgrades] = useState(false);

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

  const convertToCatalyst = useCallback(
    async (item: ResolvedItem) => {
      setUpgradeMenuFor(null);
      try {
        const res = await fetch(`${API_URL}/api/gear/catalyst-convert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_name: resolved.character.class_name,
            slot: item.slot,
            item,
          }),
        });
        if (!res.ok) return;
        const catalystItem: ResolvedItem = await res.json();

        // Add to resolved data (for display only — the backend re-generates
        // catalyst items with is_catalyst: true during combo/sim resolve)
        const updatedSlots = { ...resolved.slots };
        const slotRes = updatedSlots[item.slot];
        if (slotRes) {
          updatedSlots[item.slot] = {
            ...slotRes,
            alternatives: [...slotRes.alternatives, catalystItem],
          };
        }
        onResolvedChange({ ...resolved, slots: updatedSlots });

        // Auto-select the catalyst item
        const updated: Record<string, Set<string>> = {};
        for (const [k, v] of Object.entries(selectedUids)) {
          updated[k] = new Set(v);
        }
        if (!updated[item.slot]) updated[item.slot] = new Set();
        updated[item.slot].add(catalystItem.uid);
        onSelectionChange(updated);
      } catch {
        // silently ignore
      }
    },
    [resolved, onResolvedChange, selectedUids, onSelectionChange]
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

      // Upgraded copies are added as bag items (not equipped), so origin must be 'bags'
      // to match the UID the backend generates when parsing the appended simc line.
      const copyOrigin = 'bags';
      const copy: ResolvedItem = {
        ...item,
        origin: copyOrigin as ResolvedItem['origin'],
        uid: `${item.item_id}:${[...newBonusIds].sort((a, b) => a - b).join(':')}:${copyOrigin}:${item.slot}`,
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

      // Auto-select the upgraded copy
      const updated: Record<string, Set<string>> = {};
      for (const [k, v] of Object.entries(selectedUids)) {
        updated[k] = new Set(v);
      }
      if (!updated[item.slot]) updated[item.slot] = new Set();
      updated[item.slot].add(copy.uid);
      onSelectionChange(updated);

      setUpgradeMenuFor(null);
    },
    [resolved, upgradeOptions, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
  );

  const SOCKET_BONUS_ID = 13668;

  const addSocketCopy = useCallback(
    (item: ResolvedItem) => {
      if (item.sockets > 0) return; // already has socket
      const newBonusIds = [...item.bonus_ids, SOCKET_BONUS_ID];
      const newSimcString = item.simc_string.replace(
        /bonus_id=[0-9/:]+/,
        `bonus_id=${newBonusIds.join('/')}`
      );
      const copyOrigin = 'bags';
      const copy: ResolvedItem = {
        ...item,
        origin: copyOrigin as ResolvedItem['origin'],
        uid: `${item.item_id}:${[...newBonusIds].sort((a, b) => a - b).join(':')}:${copyOrigin}:${item.slot}`,
        bonus_ids: newBonusIds,
        simc_string: newSimcString,
        sockets: 1,
        gem_id: 0,
        gem_name: '',
        gem_icon: '',
      };
      const updatedSlots = { ...resolved.slots };
      const slotRes = updatedSlots[item.slot];
      if (slotRes) {
        updatedSlots[item.slot] = {
          ...slotRes,
          alternatives: [...slotRes.alternatives, copy],
        };
      }
      onResolvedChange({ ...resolved, slots: updatedSlots });
      onItemAdded(item.slot, newSimcString, item.origin);
      const updated: Record<string, Set<string>> = {};
      for (const [k, v] of Object.entries(selectedUids)) {
        updated[k] = new Set(v);
      }
      if (!updated[item.slot]) updated[item.slot] = new Set();
      updated[item.slot].add(copy.uid);
      onSelectionChange(updated);
      setUpgradeMenuFor(null);
    },
    [resolved, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
  );

  const removeGemCopy = useCallback(
    (item: ResolvedItem) => {
      if (!item.gem_id) return;
      const newSimcString = item.simc_string.replace(/,?gem_id=\d+/, '');
      const copyOrigin = 'bags';
      const copy: ResolvedItem = {
        ...item,
        origin: copyOrigin as ResolvedItem['origin'],
        uid: `${item.item_id}:${[...item.bonus_ids].sort((a, b) => a - b).join(':')}:nogem:${item.slot}`,
        simc_string: newSimcString,
        gem_id: 0,
        gem_name: '',
        gem_icon: '',
      };
      const updatedSlots = { ...resolved.slots };
      const slotRes = updatedSlots[item.slot];
      if (slotRes) {
        updatedSlots[item.slot] = {
          ...slotRes,
          alternatives: [...slotRes.alternatives, copy],
        };
      }
      onResolvedChange({ ...resolved, slots: updatedSlots });
      onItemAdded(item.slot, newSimcString, item.origin);
      const updated: Record<string, Set<string>> = {};
      for (const [k, v] of Object.entries(selectedUids)) {
        updated[k] = new Set(v);
      }
      if (!updated[item.slot]) updated[item.slot] = new Set();
      updated[item.slot].add(copy.uid);
      onSelectionChange(updated);
      setUpgradeMenuFor(null);
    },
    [resolved, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
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
    if (item.origin === 'vault') parts.push({ text: t('gear.greatVault'), color: 'text-amber-400/80' });
    if (item.origin === 'loot') parts.push({ text: 'Group Loot', color: 'text-sky-400/80' });
    if (item.is_catalyst) parts.push({ text: t('gear.catalyst'), color: 'text-purple-400/80' });
    if (item.tag) parts.push({ text: item.tag });
    if (item.upgrade) parts.push({ text: localizedUpgrade(item.upgrade, t) });
    if (item.gem_name) {
      parts.push({ text: localizedItemName(item.gem_id, item.gem_name, locale), color: 'text-sky-400/70' });
    } else if (item.sockets > 0) {
      parts.push({
        text: `${item.sockets > 1 ? item.sockets + ' ' : ''}${item.sockets > 1 ? t('gear.sockets') : t('gear.socket')}`,
        color: 'text-sky-400/70',
      });
    }
    if (item.enchant_name) {
      const enchantName = item.enchant_item_id
        ? localizedItemName(item.enchant_item_id, item.enchant_name, locale)
        : item.enchant_name;
      parts.push({ text: enchantName, color: 'text-emerald-400/70' });
    }
    return parts;
  }

  // Collect vault, loot, and catalyst UIDs for quick-select
  const { vaultUids, lootUids, catalystUids } = useMemo(() => {
    const vault: { uid: string; slot: string }[] = [];
    const loot: { uid: string; slot: string }[] = [];
    const catalyst: { uid: string; slot: string }[] = [];
    for (const slotRes of Object.values(resolved.slots)) {
      for (const alt of slotRes.alternatives) {
        if (alt.origin === 'vault') vault.push({ uid: alt.uid, slot: alt.slot });
        if (alt.origin === 'loot') loot.push({ uid: alt.uid, slot: alt.slot });
        if (alt.is_catalyst) catalyst.push({ uid: alt.uid, slot: alt.slot });
      }
    }
    return { vaultUids: vault, lootUids: loot, catalystUids: catalyst };
  }, [resolved]);

  if (visibleGroups.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">
          {t('gear.noAlternativesFound')}
        </p>
      </div>
    );
  }

  function toggleGroup(items: { uid: string; slot: string }[]) {
    const allSelected = items.length > 0 && items.every((c) => selectedUids[c.slot]?.has(c.uid));
    const updated: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(selectedUids)) {
      updated[k] = new Set(v);
    }
    for (const c of items) {
      if (!updated[c.slot]) updated[c.slot] = new Set();
      if (allSelected) {
        updated[c.slot].delete(c.uid);
      } else {
        updated[c.slot].add(c.uid);
      }
    }
    onSelectionChange(updated);
  }

  function deselectAll() {
    onSelectionChange({});
  }

  const comboLabel = `${comboCount.toLocaleString()} combo${comboCount !== 1 ? 's' : ''}`;
  const comboColorClass =
    comboCount > effectiveMaxCombinations
      ? 'bg-red-500/10 text-red-400'
      : comboCount > 0
        ? 'bg-surface-container-high text-white'
        : 'bg-surface-container-high text-muted';

  const hasSelection = Object.values(selectedUids).some((s) => s.size > 0);
  const allVaultSelected = vaultUids.length > 0 && vaultUids.every((c) => selectedUids[c.slot]?.has(c.uid));
  const allLootSelected = lootUids.length > 0 && lootUids.every((c) => selectedUids[c.slot]?.has(c.uid));
  const allCatalystSelected = catalystUids.length > 0 && catalystUids.every((c) => selectedUids[c.slot]?.has(c.uid));

  const quickSelectBar = (
    <div className="flex items-center gap-1.5">
      {vaultUids.length > 0 && (
        <button
          type="button"
          onClick={() => toggleGroup(vaultUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allVaultSelected
              ? 'bg-amber-400/15 text-amber-300'
              : 'text-amber-400/60 hover:bg-amber-400/10 hover:text-amber-300'
          }`}
        >
          {t('gear.vault')}
        </button>
      )}
      {lootUids.length > 0 && (
        <button
          type="button"
          onClick={() => toggleGroup(lootUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allLootSelected
              ? 'bg-sky-400/15 text-sky-300'
              : 'text-sky-400/60 hover:bg-sky-400/10 hover:text-sky-300'
          }`}
        >
          Loot
        </button>
      )}
      {catalystUids.length > 0 && (
        <button
          type="button"
          onClick={() => toggleGroup(catalystUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allCatalystSelected
              ? 'bg-purple-400/15 text-purple-300'
              : 'text-purple-400/60 hover:bg-purple-400/10 hover:text-purple-300'
          }`}
        >
          {t('gear.catalyst')}
        </button>
      )}
      {hasSelection && (
        <button
          type="button"
          onClick={deselectAll}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-on-surface-variant/50 hover:bg-white/[0.04] hover:text-on-surface transition-colors"
        >
          {t('common.clear')}
        </button>
      )}
      <span className={`rounded-md px-2.5 py-1 font-mono text-xs ${comboColorClass}`}>
        {comboLabel}
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-30 -mx-8 flex items-center justify-between border-b border-outline-variant/20 bg-background/90 px-8 py-2 backdrop-blur-sm">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">{t('gear.selectItems')}</p>
        {quickSelectBar}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleGroups.map(({ group, equipped, alternatives }) => (
          <div key={group.label} className="card space-y-1 p-3.5">
            <p className="mb-2 font-headline text-[13px] font-semibold uppercase tracking-widest text-muted">
              {t(group.label)}
            </p>

            {equipped.map((item, eqIdx) => (
              <GearItemRow
                key={`eq-${eqIdx}`}
                icon={item.icon}
                name={localizedItemName(item.item_id, item.name, locale)}
                nameColor={item.quality_color}
                details={itemDetails(item)}
                ilevel={item.ilevel}
                equipped
                href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
                wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
              >
                <UpgradeButton
                  item={item}
                  upgradeMenuFor={upgradeMenuFor}
                  upgradeOptions={upgradeOptions}
                  loadingUpgrades={loadingUpgrades}
                  onUpgradeClick={() => openUpgradeMenu(item, item.uid)}
                  onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)}
                  onCatalystConvert={item.can_catalyst ? () => convertToCatalyst(item) : undefined}
                  onAddSocket={item.sockets === 0 && ['head', 'neck', 'wrist', 'waist', 'finger1', 'finger2'].includes(item.slot) ? () => addSocketCopy(item) : undefined}
                  onRemoveGem={item.gem_id > 0 ? () => removeGemCopy(item) : undefined}
                />
              </GearItemRow>
            ))}

            {equipped.length > 0 && alternatives.length > 0 && (
              <div className="!my-1.5 border-t border-outline-variant/20" />
            )}

            {alternatives.map((item, altIdx) => (
              <GearItemRow
                key={`alt-${altIdx}`}
                icon={item.icon}
                name={localizedItemName(item.item_id, item.name, locale)}
                nameColor={item.quality_color}
                details={itemDetails(item)}
                ilevel={item.ilevel}
                selectable
                checked={isItemSelected(item, group)}
                onToggle={() => toggleItem(item, group)}
                vault={item.origin === 'vault'}
                loot={item.origin === 'loot'}
                catalyst={item.is_catalyst}
                href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
                wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
              >
                <UpgradeButton
                  item={item}
                  upgradeMenuFor={upgradeMenuFor}
                  upgradeOptions={upgradeOptions}
                  loadingUpgrades={loadingUpgrades}
                  onUpgradeClick={() => openUpgradeMenu(item, item.uid)}
                  onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)}
                  onCatalystConvert={item.can_catalyst ? () => convertToCatalyst(item) : undefined}
                  onAddSocket={item.sockets === 0 && ['head', 'neck', 'wrist', 'waist', 'finger1', 'finger2'].includes(item.slot) ? () => addSocketCopy(item) : undefined}
                  onRemoveGem={item.gem_id > 0 ? () => removeGemCopy(item) : undefined}
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
  onCatalystConvert,
  onAddSocket,
  onRemoveGem,
}: {
  item: ResolvedItem;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
  onCatalystConvert?: () => void;
  onAddSocket?: () => void;
  onRemoveGem?: () => void;
}) {
  const { t } = useLanguage();
  if (!item.upgrade && !onCatalystConvert && !onAddSocket && !onRemoveGem) return null;
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
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
          isMenuOpen
            ? 'bg-gold/20 text-gold'
            : 'text-on-surface-variant/50 hover:bg-white/[0.05] hover:text-on-surface-variant'
        }`}
        title={t('gear.addUpgradedCopy')}
      >
        <svg
          className="h-3.5 w-3.5"
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
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-outline-variant/20 bg-surface-container py-1 shadow-xl">
          {onCatalystConvert && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onCatalystConvert();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-purple-300 hover:bg-purple-500/10 hover:text-purple-200"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a1 1 0 011 1v2.07A5.001 5.001 0 0113 9a5 5 0 01-10 0 5.001 5.001 0 014-4.93V2a1 1 0 011-1zm0 5a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
              {t('gear.convertToCatalyst')}
            </button>
          )}
          {onAddSocket && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAddSocket();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 4v8M4 8h8" />
                <circle cx="8" cy="8" r="6" />
              </svg>
              {t('gear.addSocket')}
            </button>
          )}
          {onRemoveGem && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onRemoveGem();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 8h8" />
                <circle cx="8" cy="8" r="6" />
              </svg>
              {t('gear.removeGem')}
            </button>
          )}
          {(onCatalystConvert || onAddSocket || onRemoveGem) && item.upgrade && (
            <div className="my-1 border-t border-outline-variant/20" />
          )}
          {item.upgrade && (
            <>
              {loadingUpgrades ? (
                <div className="px-3 py-2 text-[13px] text-muted">{t('common.loading')}</div>
              ) : upgradeOptions.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-muted">{t('gear.noUpgradeOptions')}</div>
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
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] ${
                        isCurrent
                          ? 'cursor-default text-muted'
                          : 'text-on-surface hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      <span>{opt.fullName}</span>
                      <span className="font-mono text-[12px] tabular-nums text-muted">
                        {opt.itemLevel}
                      </span>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
