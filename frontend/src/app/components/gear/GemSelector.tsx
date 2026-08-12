'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import GearItemRow from './GearItemRow';
import type { ResolvedItem } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import Switch from '../ui/Switch';
import CollapsibleSection from '../ui/CollapsibleSection';
import { statLabel, type ItemOption } from './itemOptions';

interface GemOption extends ItemOption {
  algariColor?: string;
}

interface GemSelectorProps {
  equippedSlots: Record<string, ResolvedItem>;
  gemSelections: Set<number>;
  onGemToggle: (slot: string, gemId: number) => void;
  onSelectAllGems: (slot: string, ids: number[]) => void;
  onDeselectAllGems: (slot: string, ids?: number[]) => void;
  replaceGems?: boolean;
  onReplaceGemsChange?: (v: boolean) => void;
  diamondAlwaysUse?: boolean;
  onDiamondAlwaysUseChange?: (v: boolean) => void;
  maxColors?: boolean;
  onMaxColorsChange?: (v: boolean) => void;
  defaultOpen?: boolean;
  storageKey?: string;
}

const GEM_COLOR_CLASS: Record<string, string> = {
  amethyst: 'text-purple-400',
  garnet: 'text-red-400',
  lapis: 'text-blue-400',
  peridot: 'text-green-400',
  other: 'text-muted',
};

function gemDetails(g: GemOption): { text: string; color?: string }[] {
  const parts: { text: string; color?: string }[] = [];
  // Diamonds (quality 4): displayName carries the special effect
  if ((g.quality ?? 0) >= 4 && g.displayName) {
    parts.push({ text: g.displayName });
  } else if (g.stats && g.stats.length > 0) {
    parts.push({ text: g.stats.map(statLabel).join(', ') });
  }
  return parts;
}

export default function GemSelector({
  equippedSlots,
  gemSelections,
  onGemToggle,
  onSelectAllGems,
  onDeselectAllGems,
  replaceGems = false,
  onReplaceGemsChange = () => {},
  diamondAlwaysUse = false,
  onDiamondAlwaysUseChange = () => {},
  maxColors = false,
  onMaxColorsChange = () => {},
  defaultOpen,
  storageKey,
}: GemSelectorProps) {
  const { t } = useLanguage();
  const [gemOptions, setGemOptions] = useState<GemOption[]>([]);

  const socketedSlots = useMemo(
    () =>
      Object.entries(equippedSlots)
        .filter(([, item]) => item.sockets > 0)
        .map(([slot]) => slot),
    [equippedSlots]
  );
  const hasSocketedSlots = socketedSlots.length > 0;

  useEffect(() => {
    if (!hasSocketedSlots) return;
    fetchJsonOr<GemOption[]>(apiUrl('/api/gems?expansion=11'), []).then(setGemOptions);
  }, [hasSocketedSlots]);

  // Diamonds = quality 4, crafted rank 2 (separate from regular gems)
  const diamonds = useMemo(
    () => gemOptions.filter((g) => g.craftingQuality === 2 && (g.quality ?? 0) === 4),
    [gemOptions]
  );

  // Regular gems grouped by color: rank 2 crafted, quality 3 (Flawless rare)
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
    <CollapsibleSection
      title={t('enchantGem.selectGems')}
      subtitle={t('enchantGem.selectGemsTooltip')}
      count={gemSelections.size}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-end gap-3">
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
                      groupSelected
                        ? onDeselectAllGems('', groupIds)
                        : onSelectAllGems('', groupIds)
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
    </CollapsibleSection>
  );
}
