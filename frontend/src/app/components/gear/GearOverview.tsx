'use client';
/* eslint-disable @next/next/no-img-element */

import { Fragment, useMemo } from 'react';
import { type EnchantInfo, type GemInfo, type ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips, wowheadKeyFor } from '../../lib/useWowheadTooltips';
import CardHeader from '../ui/CardHeader';
import GearSlotRow from './GearSlotRow';
import {
  GEAR_ORDER_BOTTOM,
  GEAR_ORDER_LEFT,
  GEAR_ORDER_RIGHT,
  type GearItem,
} from './gearOverviewTypes';

interface GearOverviewProps {
  gear: Record<string, GearItem>;
  title?: string;
  characterRenderUrl?: string | null;
  upgradeSlots?: Set<string>;
  downgradeSlots?: Set<string>;
  /** Compare mode: slots where both sets carry the same change vs equipped. */
  sharedSlots?: Set<string>;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
}

export type { GearItem } from './gearOverviewTypes';

export default function GearOverview({
  gear,
  title,
  characterRenderUrl,
  upgradeSlots,
  downgradeSlots,
  sharedSlots,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
}: GearOverviewProps) {
  const { t } = useLanguage();
  const resolvedTitle = title ?? t('gear.equippedGear');

  const wowheadKey = useMemo(
    () => wowheadKeyFor({ item: itemInfoMap, enchant: enchantInfoMap, gem: gemInfoMap }),
    [itemInfoMap, enchantInfoMap, gemInfoMap]
  );
  useWowheadTooltips([wowheadKey]);

  if (Object.keys(gear).length === 0) {
    return null;
  }

  // minmax(0,…): a long gem/enchant line truncates instead of pushing the right column out.
  const gridCols = characterRenderUrl
    ? 'grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]'
    : 'grid-cols-2';
  const avgIlvl = averageItemLevel(gear);

  return (
    <section className="card relative overflow-hidden">
      <CardHeader
        title={resolvedTitle}
        right={
          avgIlvl != null && (
            <span className="text-[12.5px] text-outline">
              ilvl{' '}
              <b className="font-headline tabular-nums text-on-surface">{avgIlvl.toFixed(1)}</b>
            </span>
          )
        }
      />
      <div className="relative px-6 py-[22px]">
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
        <div className={`relative grid items-start gap-2 ${gridCols}`}>
          <div className="flex flex-col gap-1.5">
            {GEAR_ORDER_LEFT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                isShared={sharedSlots?.has(slot)}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
              />
            ))}
          </div>
          {characterRenderUrl && <div />}
          <div className="flex flex-col gap-1.5">
            {GEAR_ORDER_RIGHT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                isShared={sharedSlots?.has(slot)}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                align="right"
              />
            ))}
          </div>
        </div>
        <div className={`relative mt-1.5 grid gap-2 ${gridCols}`}>
          {GEAR_ORDER_BOTTOM.map((slot, index) => (
            <Fragment key={slot}>
              {index === 1 && characterRenderUrl && <div />}
              <GearSlotRow
                slot={slot}
                item={gear[slot]}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                isShared={sharedSlots?.has(slot)}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                align={index === 1 ? 'right' : 'left'}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Equipped item level the way the game shows it: 16 slots, a main hand with no
 *  off hand counted twice. Null when nothing has an item level. */
function averageItemLevel(gear: Record<string, GearItem>): number | null {
  const items = Object.values(gear).filter((g) => g.item_id > 0 && g.ilevel > 0);
  if (items.length === 0) return null;
  const sum = items.reduce((total, g) => total + g.ilevel, 0);
  const mainHand = gear.main_hand;
  const offHandEmpty = !gear.off_hand || gear.off_hand.item_id <= 0;
  const doubled = offHandEmpty && mainHand && mainHand.item_id > 0 && mainHand.ilevel > 0;
  return doubled ? (sum + mainHand.ilevel) / (items.length + 1) : sum / items.length;
}
