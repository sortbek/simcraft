'use client';
/* eslint-disable @next/next/no-img-element */

import {
  QUALITY_COLORS,
  getWowheadData,
  getWowheadUrl,
  localizedEnchantName,
  localizedGemName,
  localizedItemName,
  toGemIdList,
  useItemNames,
  iconProps,
} from '../../lib/useItemInfo';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { SLOT_LABELS } from '../../lib/types';
import type { GearItem } from './gearOverviewTypes';
import Pill from '../ui/Pill';

/** Mock `.gr`: 7px-radius row with a hover fill. */
const ROW =
  'flex items-center gap-3 rounded-[7px] px-2.5 py-[7px] transition-colors duration-[120ms] hover:bg-surface-container-high';

interface GearSlotRowProps {
  slot: string;
  item?: GearItem;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  /** Compare mode: both sets carry the same change vs equipped in this slot. */
  isShared?: boolean;
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
  isShared,
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
      <div className={`${ROW} ${rtl ? 'flex-row-reverse' : ''}`}>
        <div className="h-[38px] w-[38px] shrink-0 rounded-[5px] border border-dashed border-line/[0.11] bg-surface-container-high" />
        <div className={rtl ? 'text-right' : ''}>
          <p className="text-sm text-outline">{SLOT_LABELS[slot] || slot}</p>
          <p className="mt-px text-xs text-outline">{t('gear.empty')}</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gemIdList = toGemIdList(item);
  const gems = gemIdList.map((id) => gemInfoMap[id]).filter((g): g is GemInfo => !!g);
  const qualityColor = info ? QUALITY_COLORS[info.quality] || QUALITY_COLORS[1] : QUALITY_COLORS[1];
  const name = localizedItemName(
    item.item_id,
    info?.name || item.name || `Item ${item.item_id}`,
    locale
  );
  const icon = info?.icon || 'inv_misc_questionmark';
  const wowheadData = item.item_id > 0 ? getWowheadData(item) : undefined;
  const fadeDir = rtl ? 'to left' : 'to right';

  return (
    <div className={`relative ${ROW} ${rtl ? 'flex-row-reverse' : ''}`}>
      {isUpgrade && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[7px] bg-positive/[0.15] ring-1 ring-positive/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      {isDowngrade && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[7px] bg-negative/[0.15] ring-1 ring-negative/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      {isShared && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[7px] bg-info/[0.15] ring-1 ring-info/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
        data-wowhead={wowheadData}
        className="relative block h-[38px] w-[38px] shrink-0 overflow-hidden rounded-[5px] border"
        style={{ borderColor: qualityColor }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        <img
          {...iconProps(icon)}
          alt=""
          width={38}
          height={38}
          className="h-full w-full"
          loading="lazy"
        />
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
      </a>
      <div className={`min-w-0 flex-1 ${rtl ? 'text-right' : ''}`}>
        <div className={`flex items-center gap-1.5 ${rtl ? 'flex-row-reverse' : ''}`}>
          <a
            href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
            data-wowhead={wowheadData}
            className="truncate text-sm font-semibold leading-tight no-underline"
            style={{ color: qualityColor }}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            {name}
          </a>
          {isUpgrade && item.upgrade_levels ? (
            <Pill variant="positive" size="sm" className="shrink-0">
              +{item.upgrade_levels} {item.upgrade_levels === 1 ? 'level' : 'levels'}
            </Pill>
          ) : isUpgrade ? (
            <Pill variant="positive" size="sm" className="shrink-0">
              {t('gear.upgrade')}
            </Pill>
          ) : isDowngrade ? (
            <Pill variant="negative" size="sm" className="shrink-0">
              {t('gear.downgrade')}
            </Pill>
          ) : null}
          {item.origin === 'vault' && (
            <Pill variant="warning" size="sm" className="shrink-0">
              Vault
            </Pill>
          )}
          {item.origin === 'loot' && (
            <Pill variant="info" size="sm" className="shrink-0">
              Loot
            </Pill>
          )}
        </div>
        <p className="mt-px truncate text-xs text-outline">
          {SLOT_LABELS[slot] || slot}
          {item.ilevel > 0 && ` · ${item.ilevel}`}
          {info?.tag && ` · ${info.tag}`}
          {gems.length > 0 ? (
            <span className="text-gem">
              {' '}
              ·{' '}
              {gems.map((g, i) => (
                <span key={`${g.gem_id}-${i}`}>
                  {i > 0 && ', '}
                  <a
                    href={getWowheadUrl(g.gem_id, locale)}
                    className="no-underline"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.preventDefault()}
                  >
                    {localizedGemName(g, locale)}
                  </a>
                </span>
              ))}
            </span>
          ) : (
            (info?.sockets ?? 0) > 0 && (
              <span className="text-gem">
                {' '}
                · {(info?.sockets ?? 0) > 1 ? t('gear.sockets') : t('gear.socket')}
              </span>
            )
          )}
          {enchant?.name && (
            <span className="text-ench">
              {' '}
              ·{' '}
              {enchant.item_id ? (
                <a
                  href={getWowheadUrl(enchant.item_id, locale)}
                  className="no-underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.preventDefault()}
                >
                  {localizedEnchantName(enchant, locale)}
                </a>
              ) : (
                localizedEnchantName(enchant, locale)
              )}
            </span>
          )}
          {item.embellishment && (
            <span className="text-quality-epic/80"> · {item.embellishment.name}</span>
          )}
        </p>
      </div>
    </div>
  );
}
