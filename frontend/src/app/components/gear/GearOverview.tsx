'use client';
/* eslint-disable @next/next/no-img-element */

import { Fragment, useMemo } from 'react';
import { type EnchantInfo, type GemInfo, type ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips, wowheadKeyFor } from '../../lib/useWowheadTooltips';
import CardHeader from '../ui/CardHeader';
import GearSlotRow from './GearSlotRow';
import { renderCentreShift, useTrimmedRender } from './useTrimmedRender';
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
  const render = useTrimmedRender(characterRenderUrl);

  if (Object.keys(gear).length === 0) {
    return null;
  }

  // minmax(0,…): a long gem/enchant line truncates instead of pushing the right column out.
  const gridCols = characterRenderUrl
    ? 'grid-cols-[minmax(0,1fr)_clamp(180px,27%,300px)_minmax(0,1fr)]'
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
      <div className="relative overflow-hidden px-6 py-[22px]">
        {characterRenderUrl && (render.status === 'trimmed' || render.status === 'full') && (
          // Spotlight: warm key light behind the character, contact shadow at the feet.
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[380px] -translate-x-1/2">
            <div className="absolute -inset-x-[20%] -top-[10%] bottom-0 bg-[radial-gradient(ellipse_42%_55%_at_50%_38%,rgb(var(--c-gold-light)/0.16),rgb(var(--c-gold-light)/0.05)_45%,transparent_70%)]" />
            <div className="absolute bottom-[2.5%] left-1/2 h-[34px] w-[220px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.75),transparent_70%)]" />
            {render.status === 'trimmed' ? (
              <img
                src={render.src}
                alt=""
                // Same height for every race; feet on the contact shadow.
                className="absolute bottom-[4%] left-1/2 h-[88%] w-auto max-w-none [filter:drop-shadow(0_0_1px_rgba(255,230,180,0.35))_drop-shadow(0_20px_30px_rgba(0,0,0,0.6))] [mask-image:linear-gradient(to_bottom,#000_88%,transparent)]"
                style={{ transform: `translateX(-${renderCentreShift(render.bounds)}%)` }}
              />
            ) : (
              <img
                src={characterRenderUrl}
                alt=""
                // No bounds from the API: Blizzard renders stand on a ground line ~82%
                // down a mostly empty 1600×1200 canvas; scale it so that line sits on
                // the contact shadow. Tall models fade out at the body's top edge.
                className="absolute bottom-[-23%] left-1/2 h-[149%] w-auto max-w-none -translate-x-1/2 [filter:drop-shadow(0_0_1px_rgba(255,230,180,0.35))_drop-shadow(0_20px_30px_rgba(0,0,0,0.6))] [mask-image:linear-gradient(to_bottom,transparent_17%,#000_22%,#000_75%,transparent_82%)]"
              />
            )}
          </div>
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
