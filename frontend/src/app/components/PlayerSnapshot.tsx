'use client';

import { useMemo } from 'react';
import {
  useItemInfo,
  useEnchantInfo,
  useGemInfo,
  getWowheadData,
  getWowheadUrl,
  getIconUrl,
  QUALITY_COLORS,
  type ItemInfo,
  type EnchantInfo,
  type GemInfo,
  type ItemQuery,
} from '../lib/useItemInfo';
import { SLOT_LABELS } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface ResultItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
}

interface PlayerSnapshotProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  talents?: string; // Loaded talent string
  equippedGear?: Record<string, ResultItem>;
}

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

export default function PlayerSnapshot({
  playerName,
  playerClass,
  playerRealm,
  talents,
  equippedGear,
}: PlayerSnapshotProps) {
  // Extract item queries
  const itemQueries = useMemo(() => {
    if (!equippedGear) return [];
    return Object.values(equippedGear)
      .filter((it) => it.item_id > 0)
      .map((it) => ({
        item_id: it.item_id,
        bonus_ids: it.bonus_ids,
      }));
  }, [equippedGear]);

  const itemInfoMap = useItemInfo(itemQueries);

  const enchantIds = useMemo(() => {
    if (!equippedGear) return [];
    return Object.values(equippedGear)
      .map((it) => it.enchant_id)
      .filter((id): id is number => id != null && id > 0);
  }, [equippedGear]);

  const enchantInfoMap = useEnchantInfo(enchantIds);

  const gemIds = useMemo(() => {
    if (!equippedGear) return [];
    return Object.values(equippedGear)
      .map((it) => it.gem_id)
      .filter((id): id is number => id != null && id > 0);
  }, [equippedGear]);

  const gemInfoMap = useGemInfo(gemIds);
  useWowheadTooltips([itemInfoMap]);

  if (!equippedGear || Object.keys(equippedGear).length === 0) {
    return null;
  }

  const characterRenderUrl =
    playerRealm && playerName
      ? `https://simhammer.com/api/blizzard/character/${encodeURIComponent(playerRealm.toLowerCase())}/${encodeURIComponent(playerName.toLowerCase())}/media/render`
      : null;

  return (
    <div className="card relative overflow-hidden p-5">
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
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-muted">
          Player Setup
        </p>

        {talents && (
          <div className="mb-6 rounded bg-black/20 p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">
              Talents
            </p>
            <p className="break-all font-mono text-xs text-zinc-300">
              <a
                href={`https://www.wowhead.com/talent-calc/blizzard/${talents}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-gold"
                title="View on Wowhead"
              >
                {talents}
              </a>
            </p>
          </div>
        )}

        <div
          className={`grid gap-x-4 ${characterRenderUrl ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2'}`}
        >
          <div className="space-y-1">
            {GEAR_ORDER_LEFT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={equippedGear[slot]}
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
                item={equippedGear[slot]}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                align="right"
              />
            ))}
          </div>
        </div>
        <div
          className={`mt-1 grid gap-x-4 ${characterRenderUrl ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2'}`}
        >
          {GEAR_ORDER_BOTTOM.map((slot, i) => (
            <GearSlotRow
              key={slot}
              slot={slot}
              item={equippedGear[slot]}
              itemInfoMap={itemInfoMap}
              enchantInfoMap={enchantInfoMap}
              gemInfoMap={gemInfoMap}
              align={i === 1 ? 'right' : 'left'}
            />
          ))}
          {characterRenderUrl && <div />}
        </div>
      </div>
    </div>
  );
}

function GearSlotRow({
  slot,
  item,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  align = 'left',
}: {
  key?: string | number;
  slot: string;
  item?: ResultItem;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  align?: 'left' | 'right';
}) {
  const rtl = align === 'right';

  if (!item || item.item_id <= 0) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${rtl ? 'flex-row-reverse' : ''}`}
      >
        <div className="h-7 w-7 shrink-0 rounded border border-border bg-white/[0.03]" />
        <div className={rtl ? 'text-right' : ''}>
          <p className="text-[11px] text-gray-600">{SLOT_LABELS[slot] || slot}</p>
          <p className="text-[9px] text-gray-700">Empty</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gem = item.gem_id ? gemInfoMap[item.gem_id] : undefined;
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || 'inv_misc_questionmark';
  const whData = getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, item.gem_id);

  return (
    <div
      className={`relative flex items-center gap-2 rounded-lg px-2 py-1.5 ${rtl ? 'flex-row-reverse' : ''}`}
    >
      <div className="h-7 w-7 shrink-0 overflow-hidden rounded border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={28}
          height={28}
          className="h-full w-full"
          loading="lazy"
        />
      </div>
      <div className={`min-w-0 flex-1 ${rtl ? 'text-right' : ''}`}>
        <div className={`flex items-center gap-1.5 ${rtl ? 'flex-row-reverse' : ''}`}>
          <a
            href={getWowheadUrl(item.item_id)}
            data-wowhead={whData}
            className="truncate text-[11px] font-medium leading-tight no-underline"
            style={{ color: qc }}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            {name}
          </a>
        </div>
        <p className="truncate text-[9px] text-muted">
          {SLOT_LABELS[slot] || slot}
          {item.ilevel > 0 && ` · ${item.ilevel}`}
          {info?.tag && ` · ${info.tag}`}
          {gem?.name ? (
            <span className="text-sky-400/70"> · {gem.name}</span>
          ) : (
            (info?.sockets ?? 0) > 0 && <span className="text-sky-400/70"> · Socket</span>
          )}
          {enchant?.name && <span className="text-emerald-400/70"> · {enchant.name}</span>}
        </p>
      </div>
    </div>
  );
}
