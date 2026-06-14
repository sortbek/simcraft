'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import GearItemRow from './GearItemRow';
import type { ResolvedItem } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import CollapsibleSection from '../ui/CollapsibleSection';
import { statLabel, type ItemOption } from './itemOptions';

// Slots that support enchants, in display order
const ENCHANT_SLOT_ORDER = [
  'main_hand',
  'head',
  'shoulder',
  'back',
  'chest',
  'wrist',
  'legs',
  'feet',
  'finger1',
  'finger2',
];

const SLOT_DISPLAY: Record<string, string> = {
  main_hand: 'slot.mainHand',
  head: 'slot.head',
  shoulder: 'slot.shoulder',
  back: 'slot.back',
  chest: 'slot.chest',
  wrist: 'slot.wrist',
  legs: 'slot.legs',
  feet: 'slot.feet',
  finger1: 'slot.ring1',
  finger2: 'slot.ring2',
};

interface EnchantSelectorProps {
  equippedSlots: Record<string, ResolvedItem>;
  enchantSelections: Record<string, Set<number>>;
  onEnchantToggle: (slot: string, enchantId: number) => void;
  onSelectAllEnchants: (slot: string, ids: number[]) => void;
  onDeselectAllEnchants: (slot: string) => void;
}

function enchantDetails(e: ItemOption): { text: string; color?: string }[] {
  const parts: { text: string; color?: string }[] = [];
  if (e.stats && e.stats.length > 0) {
    parts.push({ text: e.stats.map(statLabel).join(', ') });
  }
  if (e.craftingQuality) {
    parts.push({ text: `Rank ${e.craftingQuality}`, color: 'text-on-surface-variant/40' });
  }
  return parts;
}

export default function EnchantSelector({
  equippedSlots,
  enchantSelections,
  onEnchantToggle,
  onSelectAllEnchants,
  onDeselectAllEnchants,
}: EnchantSelectorProps) {
  const { t } = useLanguage();
  const [enchantOptions, setItemOptions] = useState<Record<string, ItemOption[]>>({});

  // Slots that have equipped items and can be enchanted
  const enchantableSlots = useMemo(
    () => ENCHANT_SLOT_ORDER.filter((s) => equippedSlots[s]),
    [equippedSlots]
  );

  // Fetch enchant options per slot
  useEffect(() => {
    if (enchantableSlots.length === 0) return;
    const fetches = enchantableSlots.map(async (slot) => {
      try {
        const res = await fetch(
          `${API_URL}/api/enchants?expansion=11&slot=${encodeURIComponent(slot)}`
        );
        if (!res.ok) return { slot, data: [] as ItemOption[] };
        const data: ItemOption[] = await res.json();
        return { slot, data };
      } catch {
        return { slot, data: [] as ItemOption[] };
      }
    });
    Promise.all(fetches).then((results) => {
      const map: Record<string, ItemOption[]> = {};
      for (const { slot, data } of results) {
        if (data.length > 0) map[slot] = data;
      }
      setItemOptions(map);
    });
  }, [enchantableSlots]);

  // Filter to rank 2 only, then sort alphabetically
  const sortedEnchants = useMemo(() => {
    const result: Record<string, ItemOption[]> = {};
    for (const slot of enchantableSlots) {
      const options = enchantOptions[slot];
      if (!options) continue;
      result[slot] = options
        .filter((e) => !e.craftingQuality || e.craftingQuality === 2)
        .sort((a, b) => (a.itemName || a.displayName).localeCompare(b.itemName || b.displayName));
    }
    return result;
  }, [enchantableSlots, enchantOptions]);

  const enchantSlots = useMemo(
    () => ENCHANT_SLOT_ORDER.filter((s) => sortedEnchants[s]?.length > 0),
    [sortedEnchants]
  );

  if (enchantSlots.length === 0) {
    return null;
  }

  const selectedCount = Object.values(enchantSelections).reduce((sum, ids) => sum + ids.size, 0);

  return (
    <CollapsibleSection
      title={t('enchantGem.selectEnchants')}
      subtitle={t('enchantGem.selectEnchantsTooltip')}
      count={selectedCount}
      storageKey="simhammer_topgear_enchants_open"
    >
      {/* Per-slot enchant cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {enchantSlots.map((slot) => {
          const equippedId = equippedSlots[slot]?.enchant_id ?? 0;
          const equippedOption =
            equippedId > 0 ? sortedEnchants[slot].find((e) => e.id === equippedId) : undefined;
          const equippedName = equippedOption
            ? equippedOption.itemName || equippedOption.displayName
            : equippedSlots[slot]?.enchant_name || '';

          const candidates = sortedEnchants[slot].filter((e) => e.id !== equippedId);
          const candidateIds = candidates.map((e) => e.id);
          const allSelected =
            candidateIds.length > 0 && candidateIds.every((id) => enchantSelections[slot]?.has(id));

          return (
            <div key={slot} className="card space-y-1 p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-headline text-[13px] font-semibold uppercase tracking-widest text-muted">
                  {t(SLOT_DISPLAY[slot])}
                </p>
                {candidateIds.length > 0 && (
                  <button
                    onClick={() =>
                      allSelected
                        ? onDeselectAllEnchants(slot)
                        : onSelectAllEnchants(slot, candidateIds)
                    }
                    className="text-[11px] text-gold/60 transition-colors hover:text-gold"
                  >
                    {allSelected ? t('enchantGem.deselectAll') : t('enchantGem.selectAll')}
                  </button>
                )}
              </div>

              {/* Equipped enchant: always simmed as the baseline */}
              {equippedId > 0 && equippedName && (
                <GearItemRow
                  icon={equippedOption?.itemIcon || ''}
                  name={equippedName}
                  nameColor="text-on-surface"
                  details={equippedOption ? enchantDetails(equippedOption) : undefined}
                  equipped
                />
              )}

              {equippedId > 0 && equippedName && candidates.length > 0 && (
                <div className="!my-1.5 border-t border-outline-variant/20" />
              )}

              {/* Candidate enchants */}
              {candidates.map((e) => {
                const isSelected = enchantSelections[slot]?.has(e.id) ?? false;
                return (
                  <GearItemRow
                    key={e.id}
                    icon={e.itemIcon || ''}
                    name={e.itemName || e.displayName}
                    nameColor="text-on-surface"
                    details={enchantDetails(e)}
                    selectable
                    checked={isSelected}
                    onToggle={() => onEnchantToggle(slot, e.id)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
