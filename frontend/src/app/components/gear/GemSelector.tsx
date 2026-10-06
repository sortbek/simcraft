'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import GearItemRow from './GearItemRow';
import {
  GEAR_DENSITY_LAYOUT,
  gearCardClass,
  gearGridProps,
  type GearRowDensity,
} from './gearDensity';
import type { ResolvedItem } from '../../lib/types';
import { getWowheadUrl } from '../../lib/useItemInfo';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useLanguage } from '../../lib/i18n';
import Switch from '../ui/Switch';
import InfoIcon from '../ui/InfoIcon';
import { statLabel, filterDiamonds, groupGemsByColor, type GemOption } from './itemOptions';

interface GemSelectorProps {
  equippedSlots: Record<string, ResolvedItem>;
  gemSelections: Set<number>;
  onGemToggle: (slot: string, gemId: number) => void;
  onSelectAllGems: (slot: string, ids: number[]) => void;
  onDeselectAllGems: (slot: string, ids?: number[]) => void;
  /** Clears every gem selection AND the three option switches below, matching
   *  the section's own Clear. The card-level "Deselect all" routes here so the
   *  switches can't stay armed with no gems selected. */
  onClearAllGems?: () => void;
  /** Reports that there is nothing to show, so the page can drop the whole
   *  section instead of leaving a heading over an empty body. */
  onEmptyChange?: (empty: boolean) => void;
  replaceGems?: boolean;
  onReplaceGemsChange?: (v: boolean) => void;
  diamondAlwaysUse?: boolean;
  onDiamondAlwaysUseChange?: (v: boolean) => void;
  maxColors?: boolean;
  onMaxColorsChange?: (v: boolean) => void;
  density: GearRowDensity;
}

const GEM_COLOR_CLASS: Record<string, string> = {
  amethyst: 'text-quality-epic',
  garnet: 'text-negative',
  lapis: 'text-quality-rare',
  peridot: 'text-positive',
  other: 'text-outline',
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
  onClearAllGems,
  replaceGems = false,
  onReplaceGemsChange = () => {},
  diamondAlwaysUse = false,
  onDiamondAlwaysUseChange = () => {},
  maxColors = false,
  onMaxColorsChange = () => {},
  density,
  onEmptyChange,
}: GemSelectorProps) {
  const { t, locale } = useLanguage();
  const [gemOptions, setGemOptions] = useState<GemOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  useWowheadTooltips([gemOptions]);

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
    fetchJsonOr<GemOption[]>(apiUrl('/api/gems?expansion=11'), []).then((options) => {
      setGemOptions(options);
      setLoaded(true);
    });
  }, [hasSocketedSlots]);

  // Diamonds = quality 4, crafted rank 2 (separate from regular gems)
  const diamonds = useMemo(() => filterDiamonds(gemOptions), [gemOptions]);

  // Regular gems grouped by color: rank 2 crafted, quality 3 (Flawless rare)
  const gemGroups = useMemo(() => groupGemsByColor(gemOptions), [gemOptions]);

  const allGemIds = useMemo(
    () => gemGroups.flatMap((g) => g.gems.map((gem) => gem.itemId!).filter(Boolean)),
    [gemGroups]
  );

  useEffect(() => {
    if (loaded) onEmptyChange?.(gemOptions.length === 0);
  }, [loaded, gemOptions.length, onEmptyChange]);

  // Still fetching: a placeholder rather than `null`, so the section heading is
  // never left sitting over nothing.
  if (hasSocketedSlots && !loaded) {
    return <p className="py-1 text-sm text-outline">{t('common.loading')}</p>;
  }

  if (socketedSlots.length === 0 || gemOptions.length === 0) {
    return null;
  }

  const allSelected = allGemIds.length > 0 && allGemIds.every((id) => gemSelections.has(id));
  const hasAnyGemSelected = gemSelections.size > 0;

  const hasDiamondSelected = diamonds.some((d) => d.itemId && gemSelections.has(d.itemId));

  return (
    <div className="space-y-2.5">
      {/* Every switch stays mounted and only disables, so picking the first or
          last gem can't shove the grid up and down. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className={`group flex items-center gap-2 ${hasAnyGemSelected ? '' : 'opacity-40'}`}>
          <Switch
            checked={replaceGems}
            onChange={onReplaceGemsChange}
            disabled={!hasAnyGemSelected}
            aria-label={t('enchantGem.replaceGems')}
          />
          <span className="text-[12.5px] font-semibold leading-tight text-on-surface-variant transition-colors group-hover:text-on-surface">
            {t('enchantGem.replaceGems')}
          </span>
          <InfoIcon tooltip={t('enchantGem.replaceGemsTooltip')} />
        </div>

        {diamonds.length > 0 && (
          <>
            <div
              className={`group flex items-center gap-2 ${hasDiamondSelected ? '' : 'opacity-40'}`}
            >
              <Switch
                checked={diamondAlwaysUse}
                onChange={onDiamondAlwaysUseChange}
                disabled={!hasDiamondSelected}
                aria-label={t('enchantGem.alwaysUse')}
              />
              <span className="text-[12.5px] font-semibold text-on-surface-variant transition-colors group-hover:text-on-surface">
                {t('enchantGem.alwaysUse')}
              </span>
            </div>
            <div
              className={`group flex items-center gap-2 ${
                hasDiamondSelected && diamondAlwaysUse ? '' : 'opacity-40'
              }`}
            >
              <Switch
                checked={maxColors}
                onChange={onMaxColorsChange}
                disabled={!hasDiamondSelected || !diamondAlwaysUse}
                aria-label={t('enchantGem.onlyMaxColors')}
              />
              <span className="text-[12.5px] font-semibold text-on-surface-variant transition-colors group-hover:text-on-surface">
                {t('enchantGem.onlyMaxColors')}
              </span>
            </div>
          </>
        )}

        <button
          onClick={() =>
            allSelected
              ? (onClearAllGems ?? (() => onDeselectAllGems('')))()
              : onSelectAllGems('', allGemIds)
          }
          className="ml-auto font-headline text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-gold/70 transition-colors hover:text-gold"
        >
          {allSelected ? t('enchantGem.deselectAll') : t('enchantGem.selectAll')}
        </button>
      </div>

      {/* All gems in one grid — diamonds + colored groups */}
      <div {...gearGridProps(density, true)}>
        {diamonds.length > 0 && (
          <div className={gearCardClass(density)}>
            <div className={GEAR_DENSITY_LAYOUT[density].title}>
              <p className="h-card text-gold">{t('enchantGem.diamonds')}</p>
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
                  nameColor={isSelected ? 'text-gold' : 'text-on-surface'}
                  href={getWowheadUrl(gemItemId, locale)}
                  details={gemDetails(d)}
                  selectable
                  checked={isSelected}
                  onToggle={() => onGemToggle('', gemItemId)}
                  density={density}
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
            <div key={color} className={gearCardClass(density)}>
              <div
                className={`flex items-center justify-between ${GEAR_DENSITY_LAYOUT[density].title}`}
              >
                <p className={`h-card ${GEM_COLOR_CLASS[color] || 'text-outline'}`}>{colorLabel}</p>
                <button
                  onClick={() =>
                    groupSelected ? onDeselectAllGems('', groupIds) : onSelectAllGems('', groupIds)
                  }
                  className="font-headline text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-gold/70 transition-colors hover:text-gold"
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
                    href={getWowheadUrl(gemItemId, locale)}
                    details={gemDetails(g)}
                    selectable
                    checked={isSelected}
                    onToggle={() => onGemToggle('', gemItemId)}
                    density={density}
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
