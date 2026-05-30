'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import GearItemRow from './GearItemRow';
import type { ResolvedItem } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import Switch from '../ui/Switch';

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

interface EnchantOption {
  id: number;
  displayName: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  quality?: number;
  stats?: { type: string; amount: number }[];
  craftingQuality?: number;
}

interface GemOption {
  id: number;
  displayName: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  quality?: number;
  stats?: { type: string; amount: number }[];
  craftingQuality?: number;
  algariColor?: string;
}

interface EnchantGemSelectorProps {
  equippedSlots: Record<string, ResolvedItem>;
  enchantSelections: Record<string, Set<number>>;
  gemSelections: Set<number>;
  onEnchantToggle: (slot: string, enchantId: number) => void;
  onGemToggle: (slot: string, gemId: number) => void;
  onSelectAllEnchants: (slot: string, ids: number[]) => void;
  onDeselectAllEnchants: (slot: string) => void;
  onSelectAllGems: (slot: string, ids: number[]) => void;
  onDeselectAllGems: (slot: string, ids?: number[]) => void;
  replaceGems: boolean;
  onReplaceGemsChange: (v: boolean) => void;
  diamondAlwaysUse: boolean;
  onDiamondAlwaysUseChange: (v: boolean) => void;
  maxColors: boolean;
  onMaxColorsChange: (v: boolean) => void;
}

const GEM_COLOR_CLASS: Record<string, string> = {
  amethyst: 'text-purple-400',
  garnet: 'text-red-400',
  lapis: 'text-blue-400',
  peridot: 'text-green-400',
  other: 'text-muted',
};

function statLabel(stat: { type: string; amount: number }): string {
  const labels: Record<string, string> = {
    crit: 'Crit',
    haste: 'Haste',
    mastery: 'Mastery',
    vers: 'Vers',
    versatility: 'Vers',
    agility: 'Agi',
    strength: 'Str',
    intellect: 'Int',
    stragiint: 'Primary',
    stamina: 'Sta',
    armor: 'Armor',
  };
  return `${stat.amount} ${labels[stat.type] || stat.type}`;
}

function enchantDetails(e: EnchantOption): { text: string; color?: string }[] {
  const parts: { text: string; color?: string }[] = [];
  if (e.stats && e.stats.length > 0) {
    parts.push({ text: e.stats.map(statLabel).join(', ') });
  }
  if (e.craftingQuality) {
    parts.push({ text: `Rank ${e.craftingQuality}`, color: 'text-on-surface-variant/40' });
  }
  return parts;
}

function gemDetails(g: GemOption): { text: string; color?: string }[] {
  const parts: { text: string; color?: string }[] = [];
  // For diamonds (quality 4), use displayName which includes the special effect
  if ((g.quality ?? 0) >= 4 && g.displayName) {
    parts.push({ text: g.displayName });
  } else if (g.stats && g.stats.length > 0) {
    parts.push({ text: g.stats.map(statLabel).join(', ') });
  }
  return parts;
}

export default function EnchantGemSelector({
  equippedSlots,
  enchantSelections,
  gemSelections,
  onEnchantToggle,
  onGemToggle,
  onSelectAllEnchants,
  onDeselectAllEnchants,
  onSelectAllGems,
  onDeselectAllGems,
  replaceGems,
  onReplaceGemsChange,
  diamondAlwaysUse,
  onDiamondAlwaysUseChange,
  maxColors,
  onMaxColorsChange,
}: EnchantGemSelectorProps) {
  const { t } = useLanguage();
  const [enchantOptions, setEnchantOptions] = useState<Record<string, EnchantOption[]>>({});
  const [gemOptions, setGemOptions] = useState<GemOption[]>([]);

  // Slots that have equipped items and can be enchanted
  const enchantableSlots = useMemo(
    () => ENCHANT_SLOT_ORDER.filter((s) => equippedSlots[s]),
    [equippedSlots]
  );
  const hasEnchantableSlots = enchantableSlots.length > 0;

  // Slots that have sockets (gems apply to all socketed slots)
  const socketedSlots = useMemo(
    () =>
      Object.entries(equippedSlots)
        .filter(([, item]) => item.sockets > 0)
        .map(([slot]) => slot),
    [equippedSlots]
  );
  const hasSocketedSlots = socketedSlots.length > 0;

  // Fetch enchant options per slot
  useEffect(() => {
    if (!hasEnchantableSlots) return;
    const fetches = enchantableSlots.map(async (slot) => {
      try {
        const res = await fetch(
          `${API_URL}/api/enchants?expansion=11&slot=${encodeURIComponent(slot)}`
        );
        if (!res.ok) return { slot, data: [] as EnchantOption[] };
        const data: EnchantOption[] = await res.json();
        return { slot, data };
      } catch {
        return { slot, data: [] as EnchantOption[] };
      }
    });
    Promise.all(fetches).then((results) => {
      const map: Record<string, EnchantOption[]> = {};
      for (const { slot, data } of results) {
        if (data.length > 0) map[slot] = data;
      }
      setEnchantOptions(map);
    });
  }, [enchantableSlots, hasEnchantableSlots]);

  // Fetch gem options
  useEffect(() => {
    if (!hasSocketedSlots) return;
    fetch(`${API_URL}/api/gems?expansion=11`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: GemOption[]) => setGemOptions(data))
      .catch(() => setGemOptions([]));
  }, [hasSocketedSlots]);

  // Slots that have enchant options available
  const enchantSlots = useMemo(
    () => ENCHANT_SLOT_ORDER.filter((s) => enchantOptions[s]?.length > 0),
    [enchantOptions]
  );

  // Filter to rank 2 only, then sort alphabetically
  const sortedEnchants = useMemo(() => {
    const result: Record<string, EnchantOption[]> = {};
    for (const slot of enchantSlots) {
      result[slot] = enchantOptions[slot]
        .filter((e) => !e.craftingQuality || e.craftingQuality === 2)
        .sort((a, b) => (a.itemName || a.displayName).localeCompare(b.itemName || b.displayName));
    }
    return result;
  }, [enchantSlots, enchantOptions]);

  // Separate diamonds (quality 4, crafted rank 2) from regular gems
  const diamonds = useMemo(
    () => gemOptions.filter((g) => g.craftingQuality === 2 && (g.quality ?? 0) === 4),
    [gemOptions]
  );

  // Group regular gems by color: rank 2 crafted, quality 3 (Flawless rare)
  const gemGroups = useMemo(() => {
    const filtered = gemOptions.filter((g) => g.craftingQuality === 2 && (g.quality ?? 0) === 3);
    const groups: Record<string, GemOption[]> = {};
    for (const g of filtered) {
      const color = g.algariColor || 'other';
      if (!groups[color]) groups[color] = [];
      groups[color].push(g);
    }
    for (const arr of Object.values(groups)) {
      arr.sort((a, b) => (a.itemName || a.displayName).localeCompare(b.itemName || b.displayName));
    }
    const colorOrder = ['amethyst', 'garnet', 'lapis', 'peridot', 'other'];
    return colorOrder
      .filter((c) => groups[c]?.length > 0)
      .map((c) => ({ color: c, gems: groups[c] }));
  }, [gemOptions]);

  const allGemIds = useMemo(
    () => gemGroups.flatMap((g) => g.gems.map((gem) => gem.itemId!).filter(Boolean)),
    [gemGroups]
  );

  if (socketedSlots.length === 0 || gemOptions.length === 0) {
    return null;
  }

  const allSelected = allGemIds.length > 0 && allGemIds.every((id) => gemSelections.has(id));
  const hasAnyGemSelected = gemSelections.size > 0;

  return (
    <div className="space-y-4">
      {/* Header with toggles */}
      <div className="sticky top-14 z-30 -mx-8 flex items-center justify-between border-b border-outline-variant/20 bg-background/90 px-8 py-2 backdrop-blur-sm">
        <div className="flex flex-col">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            {t('enchantGem.selectGems')}
          </p>
          <p className="text-[11px] normal-case leading-snug tracking-normal text-on-surface-variant/50">
            {t('enchantGem.selectGemsTooltip')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasAnyGemSelected && (
            <div className="group flex items-center gap-2">
              <Switch
                checked={replaceGems}
                onChange={onReplaceGemsChange}
                aria-label={t('enchantGem.replaceGems')}
              />
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold leading-tight text-on-surface-variant transition-colors group-hover:text-gold">
                  {t('enchantGem.replaceGems')}
                </span>
                <span className="text-[10px] leading-snug text-on-surface-variant/40">
                  {t('enchantGem.replaceGemsTooltip')}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={() => (allSelected ? onDeselectAllGems('') : onSelectAllGems('', allGemIds))}
            className="text-[11px] text-gold/60 transition-colors hover:text-gold"
          >
            {allSelected ? t('enchantGem.deselectAll') : t('enchantGem.selectAll')}
          </button>
        </div>
      </div>

      {/* Diamond toggles bar */}
      {diamonds.length > 0 && diamonds.some((d) => d.itemId && gemSelections.has(d.itemId)) && (
        <div className="flex items-center gap-4 px-1">
          <div className="group flex items-center gap-2">
            <Switch
              checked={diamondAlwaysUse}
              onChange={onDiamondAlwaysUseChange}
              onColor="bg-amber-500"
              aria-label={t('enchantGem.alwaysUse')}
            />
            <span className="text-[11px] font-semibold text-on-surface-variant transition-colors group-hover:text-amber-400">
              {t('enchantGem.alwaysUse')}
            </span>
          </div>
          {diamondAlwaysUse && (
            <div className="group flex items-center gap-2">
              <Switch
                checked={maxColors}
                onChange={onMaxColorsChange}
                onColor="bg-amber-500"
                aria-label={t('enchantGem.onlyMaxColors')}
              />
              <span className="text-[11px] font-semibold text-on-surface-variant transition-colors group-hover:text-amber-400">
                {t('enchantGem.onlyMaxColors')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* All gems in one grid — diamonds + colored groups */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {/* Diamonds card */}
        {diamonds.length > 0 && (
          <div className="card space-y-1 p-3.5">
            <div className="mb-2">
              <p className="font-headline text-[13px] font-semibold uppercase tracking-widest text-amber-400">
                {t('enchantGem.diamonds')}
              </p>
            </div>
            {diamonds.map((d) => {
              const gemItemId = d.itemId!;
              if (!gemItemId) return null;
              const isSelected = gemSelections.has(gemItemId);

              return (
                <GearItemRow
                  key={d.id}
                  icon={d.itemIcon || ''}
                  name={d.itemName || d.displayName}
                  nameColor={isSelected ? 'text-amber-400' : 'text-on-surface'}
                  details={gemDetails(d)}
                  selectable
                  checked={isSelected}
                  onToggle={() => onGemToggle('', gemItemId)}
                />
              );
            })}
          </div>
        )}
        {gemGroups.map(({ color, gems }) => {
          const groupIds = gems.map((g) => g.itemId!).filter(Boolean);
          const groupSelected =
            groupIds.length > 0 && groupIds.every((id) => gemSelections.has(id));
          const colorLabel = color.charAt(0).toUpperCase() + color.slice(1);

          return (
            <div key={color} className="card space-y-1 p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <p
                  className={`font-headline text-[13px] font-semibold uppercase tracking-widest ${GEM_COLOR_CLASS[color] || 'text-muted'}`}
                >
                  {colorLabel}
                </p>
                <button
                  onClick={() =>
                    groupSelected ? onDeselectAllGems('', groupIds) : onSelectAllGems('', groupIds)
                  }
                  className="text-[11px] text-gold/60 transition-colors hover:text-gold"
                >
                  {groupSelected ? t('enchantGem.deselectAll') : t('enchantGem.selectAll')}
                </button>
              </div>
              {gems.map((g) => {
                const gemItemId = g.itemId!;
                if (!gemItemId) return null;
                const isSelected = gemSelections.has(gemItemId);

                return (
                  <GearItemRow
                    key={g.id}
                    icon={g.itemIcon || ''}
                    name={g.itemName || g.displayName}
                    nameColor="text-on-surface"
                    details={gemDetails(g)}
                    selectable
                    checked={isSelected}
                    onToggle={() => onGemToggle('', gemItemId)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
