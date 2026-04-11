'use client';

import { useMemo } from 'react';
import {
  useItemInfo,
  useEnchantInfo,
  useGemInfo,
  getIconUrl,
  getWowheadUrl,
  getWowheadData,
  QUALITY_COLORS,
} from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import type { ItemInfo, EnchantInfo, GemInfo, ItemQuery } from '../../lib/useItemInfo';
import { localizedItemName, localizedEnchantName, localizedGemName, useItemNames } from '../../lib/useItemInfo';
import { SLOT_LABELS } from '../../lib/types';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';

export interface GearItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
  is_kept?: boolean;
  upgrade_levels?: number;
  origin?: string;
}

// WoW character sheet order
const GEAR_ORDER_LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const GEAR_ORDER_RIGHT = [
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
];
const GEAR_ORDER_BOTTOM = ['main_hand', 'off_hand'];

interface GearOverviewProps {
  gear: Record<string, GearItem>;
  title?: string;
  characterRenderUrl?: string | null;
  /** Slots to highlight as upgrades */
  upgradeSlots?: Set<string>;
  /** Slots to highlight as downgrades */
  downgradeSlots?: Set<string>;
}

export default function GearOverview({
  gear,
  title,
  characterRenderUrl,
  upgradeSlots,
  downgradeSlots,
}: GearOverviewProps) {
  const { t } = useLanguage();
  const resolvedTitle = title ?? t('gear.equippedGear');
  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    for (const it of Object.values(gear)) {
      if (it.item_id <= 0) continue;
      const key = `${it.item_id}:${(it.bonus_ids || []).sort().join(':')}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ item_id: it.item_id, bonus_ids: it.bonus_ids });
      }
    }
    return queries;
  }, [gear]);

  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of Object.values(gear)) {
      if (it.enchant_id && it.enchant_id > 0) ids.add(it.enchant_id);
    }
    return [...ids];
  }, [gear]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of Object.values(gear)) {
      if (it.gem_id && it.gem_id > 0) ids.add(it.gem_id);
    }
    return [...ids];
  }, [gear]);

  const gemInfoMap = useGemInfo(allGemIds);
  useWowheadTooltips([itemInfoMap]);

  if (Object.keys(gear).length === 0) return null;

  return (
    <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/10 relative overflow-hidden">
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
        <h3 className="font-headline font-black text-sm uppercase tracking-widest text-on-surface-variant mb-8 border-b border-outline-variant/10 pb-4">
          {resolvedTitle}
        </h3>
        {(() => {
          const gridCols = characterRenderUrl ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2';
          return (
            <>
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
                {GEAR_ORDER_BOTTOM.map((slot, i) => (
                  <GearSlotRow
                    key={slot}
                    slot={slot}
                    item={gear[slot]}
                    isUpgrade={upgradeSlots?.has(slot)}
                    isDowngrade={downgradeSlots?.has(slot)}
                    itemInfoMap={itemInfoMap}
                    enchantInfoMap={enchantInfoMap}
                    gemInfoMap={gemInfoMap}
                    align={i === 1 ? 'right' : 'left'}
                  />
                ))}
                {characterRenderUrl && <div />}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

export function GearSlotRow({
  slot,
  item,
  isUpgrade,
  isDowngrade,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  align = 'left',
}: {
  slot: string;
  item?: GearItem;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  align?: 'left' | 'right';
}) {
  const { t, locale } = useLanguage();
  useItemNames();
  const rtl = align === 'right';

  if (!item || item.item_id <= 0) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${rtl ? 'flex-row-reverse' : ''}`}
      >
        <div className="h-7 w-7 shrink-0 rounded-md bg-surface-container-high" />
        <div className={rtl ? 'text-right' : ''}>
          <p className="text-[13px] text-on-surface-variant">{SLOT_LABELS[slot] || slot}</p>
          <p className="text-[11px] text-on-surface-variant/50">{t('gear.empty')}</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gem = item.gem_id ? gemInfoMap[item.gem_id] : undefined;
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = localizedItemName(item.item_id, info?.name || item.name || `Item ${item.item_id}`, locale);
  const icon = info?.icon || 'inv_misc_questionmark';
  const whData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, item.gem_id)
      : undefined;

  const fadeDir = rtl ? 'to left' : 'to right';

  return (
    <div
      className={`relative flex items-center gap-2 rounded-lg px-2 py-1.5 ${rtl ? 'flex-row-reverse' : ''}`}
    >
      {isUpgrade && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg bg-emerald-500/[0.15] ring-1 ring-emerald-500/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      {isDowngrade && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg bg-red-500/[0.15] ring-1 ring-red-500/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
        data-wowhead={whData}
        className="h-7 w-7 shrink-0 overflow-hidden rounded-md border border-outline-variant/20 block"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={28}
          height={28}
          className="h-full w-full"
          loading="lazy"
        />
      </a>
      <div className={`min-w-0 flex-1 ${rtl ? 'text-right' : ''}`}>
        <div className={`flex items-center gap-1.5 ${rtl ? 'flex-row-reverse' : ''}`}>
          <a
            href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
            data-wowhead={whData}
            className="truncate text-[13px] font-medium leading-tight no-underline"
            style={{ color: qc }}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            {name}
          </a>
          {isUpgrade && item.upgrade_levels ? (
            <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-px text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              +{item.upgrade_levels} {item.upgrade_levels === 1 ? 'level' : 'levels'}
            </span>
          ) : isUpgrade ? (
            <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-px text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              {t('gear.upgrade')}
            </span>
          ) : isDowngrade ? (
            <span className="shrink-0 rounded bg-red-500/10 px-1 py-px text-[10px] font-bold uppercase tracking-wider text-red-400">
              {t('gear.downgrade')}
            </span>
          ) : null}
          {item.origin === 'vault' && (
            <span className="shrink-0 rounded bg-amber-400/10 px-1 py-px text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Vault
            </span>
          )}
          {item.origin === 'loot' && (
            <span className="shrink-0 rounded bg-sky-400/10 px-1 py-px text-[10px] font-bold uppercase tracking-wider text-sky-400">
              Loot
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-muted">
          {SLOT_LABELS[slot] || slot}
          {item.ilevel > 0 && ` · ${item.ilevel}`}
          {info?.tag && ` · ${info.tag}`}
          {gem?.name ? (
            <span className="text-sky-400/70"> · {localizedGemName(gem, locale)}</span>
          ) : (
            (info?.sockets ?? 0) > 0 && <span className="text-sky-400/70"> · {(info?.sockets ?? 0) > 1 ? t('gear.sockets') : t('gear.socket')}</span>
          )}
          {enchant?.name && <span className="text-emerald-400/70"> · {localizedEnchantName(enchant, locale)}</span>}
        </p>
      </div>
    </div>
  );
}
