'use client';

import { useCallback, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import type { ItemOrigin, ResolveGearResponse, ResolvedItem } from '../../lib/types';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useLanguage } from '../../lib/i18n';
import { localizedItemName, localizedUpgrade, useItemNames } from '../../lib/useItemInfo';
import GemEnchantEditDialog from './GemEnchantEditDialog';
import { GEAR_DENSITY_LAYOUT, gearGridColumns, type GearRowDensity } from './gearDensity';
import TopGearGroupCard from './TopGearGroupCard';
import TopGearUnchangedStrip from './TopGearUnchangedStrip';
import { buildAlternativeKey, buildResolvedCopy } from './topGearIdentity';
import {
  buildVisibleGroups,
  isItemSelected as getIsItemSelected,
  mergeAlternative,
  partitionByAlternatives,
  selectAlternative,
  toggleItemSelection,
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
  onManualItemAdded: (item: ResolvedItem) => void;
  addedKeys: Set<string>;
  onRemoveAdded: (item: ResolvedItem) => void;
  density: GearRowDensity;
  /** Group labels the user opened out of the unchanged strip. */
  promotedGroups: Set<string>;
  onPromoteGroup: (label: string) => void;
  onDemoteGroup: (label: string) => void;
}

const SOCKET_BONUS_ID = 13668;

export default function TopGearItemSelector({
  resolved,
  selectedUids,
  onSelectionChange,
  onResolvedChange,
  onItemAdded,
  onManualItemAdded,
  addedKeys,
  onRemoveAdded,
  density,
  promotedGroups,
  onPromoteGroup,
  onDemoteGroup,
}: TopGearItemSelectorProps) {
  const { t, locale } = useLanguage();
  useItemNames();
  const [upgradeMenuFor, setUpgradeMenuFor] = useState<string | null>(null);
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeOption[]>([]);
  const [loadingUpgrades, setLoadingUpgrades] = useState(false);
  const [editItem, setEditItem] = useState<ResolvedItem | null>(null);

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

  const convertToVoidForge = useCallback(
    async (item: ResolvedItem) => {
      setUpgradeMenuFor(null);
      try {
        const response = await fetch(`${API_URL}/api/gear/void-forge-convert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item }),
        });
        if (!response.ok) return;

        const vfItem: ResolvedItem = await response.json();
        onResolvedChange(mergeAlternative(resolved, item.slot, vfItem));
        onSelectionChange(selectAlternative(selectedUids, item.slot, vfItem.uid));
      } catch {
        // Intentionally ignored so the selector stays usable.
      }
    },
    [resolved, onResolvedChange, selectedUids, onSelectionChange]
  );

  const applyItemEdit = useCallback(
    async (item: ResolvedItem, gemIds: number[], enchantId: number) => {
      setUpgradeMenuFor(null);
      try {
        const response = await fetch(`${API_URL}/api/gear/modify-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item, gem_ids: gemIds, enchant_id: enchantId }),
        });
        if (!response.ok) return;

        const modified: ResolvedItem = await response.json();
        const duplicate = (resolved.slots[item.slot]?.alternatives ?? []).find(
          (alt) => buildAlternativeKey(alt) === buildAlternativeKey(modified)
        );
        if (duplicate) {
          onSelectionChange(selectAlternative(selectedUids, item.slot, duplicate.uid));
          return;
        }
        onResolvedChange(mergeAlternative(resolved, item.slot, modified));
        onManualItemAdded(modified);
        onSelectionChange(selectAlternative(selectedUids, item.slot, modified.uid));
      } catch {
        // Intentionally ignored so the selector stays usable.
      }
    },
    [resolved, onResolvedChange, onManualItemAdded, selectedUids, onSelectionChange]
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
        gem_ids: [],
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
      if (item.gem_ids.length === 0) return;
      void applyItemEdit(item, [], item.enchant_id);
    },
    [applyItemEdit]
  );

  const visibleGroups = useMemo(() => buildVisibleGroups(resolved), [resolved]);
  const { cards, unchanged } = useMemo(
    () => partitionByAlternatives(visibleGroups, promotedGroups),
    [visibleGroups, promotedGroups]
  );

  const itemDetails = useCallback(
    (item: ResolvedItem): { text: string; color?: string }[] => {
      const parts: { text: string; color?: string }[] = [];
      if (addedKeys.has(buildAlternativeKey(item))) {
        parts.push({ text: 'Added', color: 'text-gold/90' });
      }
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
    [locale, t, addedKeys]
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

  if (visibleGroups.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">{t('gear.noAlternativesFound')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div
        className={`grid ${GEAR_DENSITY_LAYOUT[density].gap}`}
        style={{ gridTemplateColumns: gearGridColumns(density) }}
      >
        {cards.map(({ group, equipped, alternatives }) => (
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
            onVoidForgeConvert={convertToVoidForge}
            onAddSocket={addSocketCopy}
            onRemoveGem={removeGemCopy}
            onEditGemsEnchant={(item) => {
              setUpgradeMenuFor(null);
              setEditItem(item);
            }}
            addedKeys={addedKeys}
            onRemoveAdded={onRemoveAdded}
            density={density}
            // Only a group that is in the grid *because* it was promoted can go
            // back; one with real alternatives has nothing to go back to.
            onDemote={
              alternatives.length === 0 && promotedGroups.has(group.label)
                ? () => onDemoteGroup(group.label)
                : undefined
            }
            t={t}
          />
        ))}
      </div>

      <TopGearUnchangedStrip groups={unchanged} locale={locale} onPromote={onPromoteGroup} t={t} />

      {editItem && (
        <GemEnchantEditDialog
          item={editItem}
          onClose={() => setEditItem(null)}
          onConfirm={async (gemIds, enchantId) => {
            await applyItemEdit(editItem, gemIds, enchantId);
            setEditItem(null);
          }}
        />
      )}
    </div>
  );
}
