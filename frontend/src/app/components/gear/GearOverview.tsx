'use client';
/* eslint-disable @next/next/no-img-element */

import { useMemo } from 'react';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import GearSlotRow from './GearSlotRow';
import {
  GEAR_ORDER_BOTTOM,
  GEAR_ORDER_LEFT,
  GEAR_ORDER_RIGHT,
  type GearItem,
} from './gearOverviewTypes';
import { collectEnchantIds, collectGemIds, collectItemQueries } from './gearOverviewUtils';

interface GearOverviewProps {
  gear: Record<string, GearItem>;
  title?: string;
  characterRenderUrl?: string | null;
  upgradeSlots?: Set<string>;
  downgradeSlots?: Set<string>;
}

export type { GearItem } from './gearOverviewTypes';

export default function GearOverview({
  gear,
  title,
  characterRenderUrl,
  upgradeSlots,
  downgradeSlots,
}: GearOverviewProps) {
  const { t } = useLanguage();
  const resolvedTitle = title ?? t('gear.equippedGear');

  const allItemQueries = useMemo(() => collectItemQueries(gear), [gear]);
  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => collectEnchantIds(gear), [gear]);
  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => collectGemIds(gear), [gear]);
  const gemInfoMap = useGemInfo(allGemIds);

  useWowheadTooltips([itemInfoMap]);

  if (Object.keys(gear).length === 0) {
    return null;
  }

  const gridCols = characterRenderUrl ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2';

  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low p-6">
      {characterRenderUrl && (
        <img
          src={characterRenderUrl}
          alt=""
          className="pointer-events-none absolute inset-0 mx-auto h-[130%] w-auto -translate-y-[12%] object-contain opacity-30"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="relative">
        <h3 className="mb-8 border-b border-outline-variant/10 pb-4 font-headline text-sm font-black uppercase tracking-widest text-on-surface-variant">
          {resolvedTitle}
        </h3>
        <div className={`grid gap-x-4 ${gridCols}`}>
          <div className="space-y-1">
            {GEAR_ORDER_LEFT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
              />
            ))}
          </div>
          {characterRenderUrl && <div />}
          <div className="space-y-1">
            {GEAR_ORDER_RIGHT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                align="right"
              />
            ))}
          </div>
        </div>
        <div className={`mt-1 grid gap-x-4 ${gridCols}`}>
          {GEAR_ORDER_BOTTOM.map((slot, index) => (
            <GearSlotRow
              key={slot}
              slot={slot}
              item={gear[slot]}
              isUpgrade={upgradeSlots?.has(slot)}
              isDowngrade={downgradeSlots?.has(slot)}
              itemInfoMap={itemInfoMap}
              enchantInfoMap={enchantInfoMap}
              gemInfoMap={gemInfoMap}
              align={index === 1 ? 'right' : 'left'}
            />
          ))}
          {characterRenderUrl && <div />}
        </div>
      </div>
    </div>
  );
}
