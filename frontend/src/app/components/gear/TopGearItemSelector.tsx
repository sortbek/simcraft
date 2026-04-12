'use client';

import { useCallback, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import type { ItemOrigin, ResolveGearResponse, ResolvedItem } from '../../lib/types';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useLanguage } from '../../lib/i18n';
import { localizedItemName, localizedUpgrade, useItemNames } from '../../lib/useItemInfo';
import TopGearGroupCard from './TopGearGroupCard';
import TopGearQuickSelectBar from './TopGearQuickSelectBar';
import { buildResolvedCopy } from './topGearIdentity';
import {
  buildVisibleGroups,
  collectQuickSelectEntries,
  isItemSelected as getIsItemSelected,
  toggleItemSelection,
  toggleQuickSelectGroup,
  type DisplayGroup,
} from './topGearSelection';

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
  onItemAdded: (slot: string, simcString: string, origin: ItemOrigin) => void;
  comboCount: number;
  comboError: string;
}

const SOCKET_BONUS_ID = 13668;

function mergeAlternative(
  resolved: ResolveGearResponse,
  slot: string,
  alternative: ResolvedItem
): ResolveGearResponse {
  const updatedSlots = { ...resolved.slots };
  const slotResolution = updatedSlots[slot];
  if (!slotResolution) return resolved;

  updatedSlots[slot] = {
    ...slotResolution,
    alternatives: [...slotResolution.alternatives, alternative],
  };
  return { ...resolved, slots: updatedSlots };
}

function selectAlternative(
  selectedUids: Record<string, Set<string>>,
  slot: string,
  uid: string
): Record<string, Set<string>> {
  const updated = Object.fromEntries(
    Object.entries(selectedUids).map(([key, values]) => [key, new Set(values)])
  ) as Record<string, Set<string>>;
  if (!updated[slot]) updated[slot] = new Set();
  updated[slot].add(uid);
  return updated;
}

export default function TopGearItemSelector({
  resolved,
  selectedUids,
  onSelectionChange,
  onResolvedChange,
  onItemAdded,
  comboCount,
  comboError,
}: TopGearItemSelectorProps) {
  const { t, locale } = useLanguage();
  useItemNames();
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
        const response = await fetch(
          `${API_URL}/api/upgrade-options?bonus_ids=${item.bonus_ids.join(',')}`
        );
        const data = await response.json();
        setUpgradeOptions(data.options || []);
      } catch {
        setUpgradeOptions([]);
      } finally {
        setLoadingUpgrades(false);
      }
    },
    [upgradeMenuFor]
  );

  const convertToCatalyst = useCallback(
    async (item: ResolvedItem) => {
      setUpgradeMenuFor(null);
      try {
        const response = await fetch(`${API_URL}/api/gear/catalyst-convert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_name: resolved.character.class_name,
            slot: item.slot,
            item,
          }),
        });
        if (!response.ok) return;

        const catalystItem: ResolvedItem = await response.json();
        onResolvedChange(mergeAlternative(resolved, item.slot, catalystItem));
        onSelectionChange(selectAlternative(selectedUids, item.slot, catalystItem.uid));
      } catch {
        // Intentionally ignored so the selector stays usable.
      }
    },
    [resolved, onResolvedChange, selectedUids, onSelectionChange]
  );

  const addUpgradedCopy = useCallback(
    (item: ResolvedItem, option: UpgradeOption) => {
      const currentUpgradeBonusId = upgradeOptions.find((entry) =>
        item.bonus_ids.includes(entry.bonus_id)
      )?.bonus_id;
      if (!currentUpgradeBonusId) return;

      const newBonusIds = item.bonus_ids.map((bonusId) =>
        bonusId === currentUpgradeBonusId ? option.bonus_id : bonusId
      );
      const newSimcString = item.simc_string.replace(
        /bonus_id=[0-9/:]+/,
        `bonus_id=${newBonusIds.join('/')}`
      );
      const copy = buildResolvedCopy(item, {
        origin: 'bags',
        bonus_ids: newBonusIds,
        simc_string: newSimcString,
        ilevel: option.itemLevel,
        upgrade: option.fullName,
      });

      onResolvedChange(mergeAlternative(resolved, item.slot, copy));
      onItemAdded(item.slot, newSimcString, 'bags');
      onSelectionChange(selectAlternative(selectedUids, item.slot, copy.uid));
      setUpgradeMenuFor(null);
    },
    [resolved, upgradeOptions, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
  );

  const addSocketCopy = useCallback(
    (item: ResolvedItem) => {
      if (item.sockets > 0) return;

      const newBonusIds = [...item.bonus_ids, SOCKET_BONUS_ID];
      const newSimcString = item.simc_string.replace(
        /bonus_id=[0-9/:]+/,
        `bonus_id=${newBonusIds.join('/')}`
      );
      const copy = buildResolvedCopy(item, {
        origin: 'bags',
        bonus_ids: newBonusIds,
        simc_string: newSimcString,
        sockets: 1,
        gem_id: 0,
        gem_name: '',
        gem_icon: '',
      });

      onResolvedChange(mergeAlternative(resolved, item.slot, copy));
      onItemAdded(item.slot, newSimcString, 'bags');
      onSelectionChange(selectAlternative(selectedUids, item.slot, copy.uid));
      setUpgradeMenuFor(null);
    },
    [resolved, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
  );

  const removeGemCopy = useCallback(
    (item: ResolvedItem) => {
      if (!item.gem_id) return;

      const newSimcString = item.simc_string.replace(/,?gem_id=\d+/, '');
      const copy = buildResolvedCopy(item, {
        origin: 'bags',
        simc_string: newSimcString,
        gem_id: 0,
        gem_name: '',
        gem_icon: '',
      });

      onResolvedChange(mergeAlternative(resolved, item.slot, copy));
      onItemAdded(item.slot, newSimcString, 'bags');
      onSelectionChange(selectAlternative(selectedUids, item.slot, copy.uid));
      setUpgradeMenuFor(null);
    },
    [resolved, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
  );

  const visibleGroups = useMemo(() => buildVisibleGroups(resolved), [resolved]);
  const { vaultUids, lootUids, catalystUids } = useMemo(
    () => collectQuickSelectEntries(resolved),
    [resolved]
  );

  const itemDetails = useCallback(
    (item: ResolvedItem): { text: string; color?: string }[] => {
      const parts: { text: string; color?: string }[] = [];
      if (item.origin === 'vault') {
        parts.push({ text: t('gear.greatVault'), color: 'text-amber-400/80' });
      }
      if (item.origin === 'loot') {
        parts.push({ text: 'Group Loot', color: 'text-sky-400/80' });
      }
      if (item.is_catalyst) {
        parts.push({ text: t('gear.catalyst'), color: 'text-purple-400/80' });
      }
      if (item.tag) parts.push({ text: item.tag });
      if (item.upgrade) parts.push({ text: localizedUpgrade(item.upgrade, t) });
      if (item.gem_name) {
        parts.push({
          text: localizedItemName(item.gem_id, item.gem_name, locale),
          color: 'text-sky-400/70',
        });
      } else if (item.sockets > 0) {
        parts.push({
          text: `${item.sockets > 1 ? `${item.sockets} ` : ''}${
            item.sockets > 1 ? t('gear.sockets') : t('gear.socket')
          }`,
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
    },
    [locale, t]
  );

  const isSelected = useCallback(
    (item: ResolvedItem, group: DisplayGroup) =>
      getIsItemSelected(item, group, resolved, selectedUids),
    [resolved, selectedUids]
  );

  const onToggleItem = useCallback(
    (item: ResolvedItem, group: DisplayGroup) => {
      onSelectionChange(toggleItemSelection(item, group, resolved, selectedUids));
    },
    [onSelectionChange, resolved, selectedUids]
  );

  const onToggleGroup = useCallback(
    (entries: { uid: string; slot: string }[]) => {
      onSelectionChange(toggleQuickSelectGroup(entries, selectedUids));
    },
    [onSelectionChange, selectedUids]
  );

  if (visibleGroups.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">{t('gear.noAlternativesFound')}</p>
      </div>
    );
  }

  const comboLabel = `${comboCount.toLocaleString()} combo${comboCount !== 1 ? 's' : ''}`;
  const comboColorClass = comboError
    ? 'bg-red-500/10 text-red-400'
    : comboCount > 0
      ? 'bg-surface-container-high text-white'
      : 'bg-surface-container-high text-muted';

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-30 -mx-8 flex items-center justify-between border-b border-outline-variant/20 bg-background/90 px-8 py-2 backdrop-blur-sm">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">
          {t('gear.selectItems')}
        </p>
        <TopGearQuickSelectBar
          vaultUids={vaultUids}
          lootUids={lootUids}
          catalystUids={catalystUids}
          selectedUids={selectedUids}
          comboLabel={comboLabel}
          comboColorClass={comboColorClass}
          onToggleGroup={onToggleGroup}
          onDeselectAll={() => onSelectionChange({})}
          t={t}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleGroups.map(({ group, equipped, alternatives }) => (
          <TopGearGroupCard
            key={group.label}
            group={group}
            equipped={equipped}
            alternatives={alternatives}
            locale={locale}
            title={t(group.label)}
            itemDetails={itemDetails}
            isItemSelected={isSelected}
            onToggleItem={onToggleItem}
            upgradeMenuFor={upgradeMenuFor}
            upgradeOptions={upgradeOptions}
            loadingUpgrades={loadingUpgrades}
            onUpgradeClick={openUpgradeMenu}
            onUpgradeSelect={addUpgradedCopy}
            onCatalystConvert={convertToCatalyst}
            onAddSocket={addSocketCopy}
            onRemoveGem={removeGemCopy}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}
