'use client';
/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from 'react';
import { SLOT_LABELS, specDisplayName } from '../../lib/types';
import {
  QUALITY_COLORS,
  getWowheadData,
  getWowheadUrl,
  iconProps,
  localizedItemName,
  useItemNames,
  type GemInfo,
  type ItemInfo,
} from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { useConsumableLookup } from '../sim-config/ConsumablePickers';
import type { ResultItem, TopGearResult } from './topGearResultsTypes';

const MAX_TILES = 6;
const TILE = 'relative block h-[34px] w-[34px] shrink-0 overflow-hidden rounded-[6px] border';

/** Corner marker on an item tile: catalyst, Void Forged. */
function Corner({ className }: { className: string }) {
  return (
    <span
      className={cn(
        'absolute -bottom-px -right-px h-[10px] w-[10px] rounded-tl-[4px] shadow-[0_0_0_1.5px_rgb(var(--c-surface-container))]',
        className
      )}
    />
  );
}

/** A non-item change (talents, folio, enchant) drawn as a tinted glyph tile. */
function GlyphTile({
  title,
  tone,
  children,
}: {
  title: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <span title={title} className={cn(TILE, 'grid place-items-center border-transparent', tone)}>
      <svg
        className="h-[18px] w-[18px]"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

function ItemTile({ item, info, locale }: { item: ResultItem; info?: ItemInfo; locale: string }) {
  const color = info ? QUALITY_COLORS[info.quality] || QUALITY_COLORS[1] : QUALITY_COLORS[1];
  const href = item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined;
  return (
    <a
      href={href}
      data-wowhead={item.item_id > 0 ? getWowheadData(item) : undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.preventDefault()}
      className={cn(TILE, item.is_kept && 'opacity-40')}
      style={{ borderColor: color }}
    >
      <img
        {...iconProps(info?.icon || 'inv_misc_questionmark')}
        alt=""
        width={34}
        height={34}
        className="h-full w-full"
        loading="lazy"
      />
      <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
      {item.is_catalyst && <Corner className="bg-info" />}
      {item.is_void_forge && <Corner className="bg-quality-epic" />}
      {!!item.upgrade_levels && (
        <span className="absolute left-0 top-0 rounded-br-[4px] bg-black/75 px-[3px] text-[9px] font-extrabold leading-[13px] text-positive">
          +{item.upgrade_levels}
        </span>
      )}
    </a>
  );
}

interface ComboSummaryProps {
  result: TopGearResult;
  /** Gear rows to draw: changed items plus a kept ring/trinket partner for context. */
  displayItems: ResultItem[];
  changedItems: ResultItem[];
  enchantGemItems: ResultItem[];
  isEquipped: boolean;
  itemInfoMap: Record<number, ItemInfo>;
  gemInfoMap: Record<number, GemInfo>;
  badge?: ReactNode;
}

/** A ranked combination as an icon strip plus two lines: what changes, and how. */
export default function ComboSummary({
  result,
  displayItems,
  changedItems,
  enchantGemItems,
  isEquipped,
  itemInfoMap,
  gemInfoMap,
  badge,
}: ComboSummaryProps) {
  const { t, locale } = useLanguage();
  const lookup = useConsumableLookup();
  useItemNames();

  const consumables = Object.entries(result.consumables ?? {}).map(([slot, value]) => {
    const entry = lookup.get(value);
    return { slot, name: entry?.shortName || entry?.name || value, icon: entry?.icon };
  });
  const talents = result.talent_build
    ? [result.talent_spec && specDisplayName(result.talent_spec), result.talent_build]
        .filter(Boolean)
        .join(' · ')
    : '';

  const tiles: ReactNode[] = [];
  displayItems.forEach((item, i) =>
    tiles.push(
      <ItemTile
        key={`i${i}`}
        item={item}
        info={item.item_id > 0 ? itemInfoMap[item.item_id] : undefined}
        locale={locale}
      />
    )
  );
  enchantGemItems.forEach((item, i) => {
    const gem = item.type === 'gem' && item.gem_id ? gemInfoMap[item.gem_id] : undefined;
    tiles.push(
      gem ? (
        <span key={`g${i}`} title={item.name} className={cn(TILE, 'border-line/15')}>
          <img {...iconProps(gem.icon)} alt="" className="h-full w-full" loading="lazy" />
        </span>
      ) : (
        <GlyphTile key={`e${i}`} title={item.name || t('gear.enchant')} tone="bg-ench/10 text-ench">
          <path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z" />
        </GlyphTile>
      )
    );
  });
  if (talents)
    tiles.push(
      <GlyphTile key="talents" title={talents} tone="bg-quality-epic/10 text-quality-epic">
        <circle cx="10" cy="4.5" r="2" />
        <circle cx="5" cy="15.5" r="2" />
        <circle cx="15" cy="15.5" r="2" />
        <path d="M10 6.5v3M10 9.5l-4.2 4.3M10 9.5l4.2 4.3" />
      </GlyphTile>
    );
  if (result.folio_build)
    tiles.push(
      <GlyphTile key="folio" title={result.folio_build} tone="bg-info/10 text-info">
        <path d="M4 4.5A1.5 1.5 0 015.5 3H15v12H5.5A1.5 1.5 0 004 16.5zM4 16.5A1.5 1.5 0 005.5 18H15v-3" />
      </GlyphTile>
    );
  consumables.forEach((c) =>
    tiles.push(
      <span key={`c${c.slot}`} title={c.name} className={cn(TILE, 'border-line/15')}>
        {c.icon && <img {...iconProps(c.icon)} alt="" className="h-full w-full" />}
      </span>
    )
  );

  // Non-item changes in reading order, each with its colour.
  const labels: { text: string; className: string }[] = [
    ...(talents ? [{ text: talents, className: 'text-quality-epic' }] : []),
    ...(result.folio_build ? [{ text: result.folio_build, className: 'text-info' }] : []),
    ...enchantGemItems.map((item) => ({ text: item.name ?? '', className: 'text-ench' })),
    ...consumables.map((c) => ({ text: c.name, className: 'text-on-surface-variant' })),
  ];

  // First line: the first changed item, else the first other change.
  const first = changedItems[0];
  const firstInfo = first && first.item_id > 0 ? itemInfoMap[first.item_id] : undefined;
  const titleLabel = first ? null : labels[0];
  const otherCount = changedItems.length + labels.length - 1;
  const title = first ? (
    <span
      style={{ color: firstInfo ? QUALITY_COLORS[firstInfo.quality] : undefined }}
      className="truncate"
    >
      {localizedItemName(first.item_id, firstInfo?.name || first.name || '', locale)}
    </span>
  ) : titleLabel ? (
    <span className={cn('truncate', titleLabel.className)}>{titleLabel.text}</span>
  ) : null;

  // Second line: everything else, briefly; never the title again.
  const catalysts = changedItems.filter((i) => i.is_catalyst).length;
  const voidForged = changedItems.filter((i) => i.is_void_forge).length;
  const parts: ReactNode[] = [];
  if (changedItems.length)
    parts.push(changedItems.map((i) => SLOT_LABELS[i.slot] || i.slot).join(', '));
  if (catalysts)
    parts.push(<span className="text-info">{t('gear.catalystCount', { count: catalysts })}</span>);
  if (voidForged)
    parts.push(
      <span className="text-quality-epic">{t('gear.voidForgedCount', { count: voidForged })}</span>
    );
  for (const label of labels) {
    if (label !== titleLabel) parts.push(<span className={label.className}>{label.text}</span>);
  }

  if (isEquipped && tiles.length === 0) {
    return (
      <span className="inline-flex h-6 items-center rounded-[6px] bg-overlay/[0.06] px-2.5 font-headline text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-on-surface-variant">
        {t('gear.currentlyEquipped')}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <div className="flex shrink-0 gap-1.5">
        {tiles.slice(0, MAX_TILES)}
        {tiles.length > MAX_TILES && (
          <span
            className={cn(
              TILE,
              'grid place-items-center border-line/15 text-xs font-bold text-outline'
            )}
          >
            +{tiles.length - MAX_TILES}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
          {isEquipped && (
            <span className="shrink-0 text-on-surface-variant">
              {t('gear.currentlyEquipped')} ·
            </span>
          )}
          {title}
          {otherCount > 0 && (
            <span className="shrink-0 text-xs font-medium text-outline">
              {t('gear.moreCount', { count: otherCount })}
            </span>
          )}
          {badge}
        </div>
        {parts.length > 0 && (
          <div className="mt-0.5 truncate text-xs text-outline">
            {parts.map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {part}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
