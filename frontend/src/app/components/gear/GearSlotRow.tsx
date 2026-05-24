'use client';
/* eslint-disable @next/next/no-img-element */

import {
  QUALITY_COLORS,
  getIconUrl,
  getWowheadData,
  getWowheadUrl,
  localizedEnchantName,
  localizedGemName,
  localizedItemName,
  toGemIdList,
  useItemNames,
} from '../../lib/useItemInfo';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { SLOT_LABELS } from '../../lib/types';
import type { GearItem } from './gearOverviewTypes';

interface GearSlotRowProps {
  slot: string;
  item?: GearItem;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  align?: 'left' | 'right';
}

export default function GearSlotRow({
  slot,
  item,
  isUpgrade,
  isDowngrade,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  align = 'left',
}: GearSlotRowProps) {
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
  const gemIdList = toGemIdList(item);
  const gems = gemIdList.map((id) => gemInfoMap[id]).filter((g): g is GemInfo => !!g);
  const qualityColor = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = localizedItemName(
    item.item_id,
    info?.name || item.name || `Item ${item.item_id}`,
    locale
  );
  const icon = info?.icon || 'inv_misc_questionmark';
  const wowheadData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, gemIdList)
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
        data-wowhead={wowheadData}
        className="block h-7 w-7 shrink-0 overflow-hidden rounded-md border border-outline-variant/20"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
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
            data-wowhead={wowheadData}
            className="truncate text-[13px] font-medium leading-tight no-underline"
            style={{ color: qualityColor }}
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
          {gems.length > 0 ? (
            <span className="text-sky-400/70">
              {' '}
              · {gems.map((g) => localizedGemName(g, locale)).join(', ')}
            </span>
          ) : (
            (info?.sockets ?? 0) > 0 && (
              <span className="text-sky-400/70">
                {' '}
                · {(info?.sockets ?? 0) > 1 ? t('gear.sockets') : t('gear.socket')}
              </span>
            )
          )}
          {enchant?.name && (
            <span className="text-emerald-400/70"> · {localizedEnchantName(enchant, locale)}</span>
          )}
        </p>
      </div>
    </div>
  );
}
