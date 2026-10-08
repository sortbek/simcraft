'use client';

import { useRouter } from 'next/navigation';
import { memo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { simRow } from '../../lib/api';
import { SLOT_LABELS, specDisplayName } from '../../lib/types';
import {
  QUALITY_COLORS,
  getWowheadData,
  getWowheadUrl,
  localizedEnchantName,
  localizedGemName,
  localizedItemName,
  useItemNames,
  iconProps,
} from '../../lib/useItemInfo';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import type { ResultItem, TopGearResult } from './topGearResultsTypes';
import { appliedGems, gemBadgeClass } from './topGearResultsUtils';
import Button from '../ui/Button';
import Pill from '../ui/Pill';
import { useConsumableLookup } from '../sim-config/ConsumablePickers';

/** Numeric combo id from a "Combo N" name; null for other shapes (e.g. "Currently Equipped"). */
function comboIdFromName(name: string): number | null {
  const match = name.match(/^Combo (\d+)$/);
  return match ? Number(match[1]) : null;
}

/** Dot tone for precision (95% CI half-width as % of mean = how trustworthy the DPS is,
 * not what was targeted). Greener = tighter: ≤0.5 green, ≤1 emerald, ≤2 yellow, ≤4 orange, else red. */
function precisionDotTone(pct: number): string {
  if (pct <= 0.5) return 'bg-emerald-400';
  if (pct <= 1.0) return 'bg-emerald-500';
  if (pct <= 2.0) return 'bg-yellow-400';
  if (pct <= 4.0) return 'bg-orange-400';
  return 'bg-red-500';
}

/** Short band name shown as the precision tooltip header (mirrors the dot tone). */
function precisionBandLabel(
  pct: number,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (pct <= 0.5) return t('gear.precisionFinal');
  if (pct <= 1.0) return t('gear.precisionRefine');
  if (pct <= 2.0) return t('gear.precisionCoarse');
  if (pct <= 4.0) return t('gear.precisionProbe');
  return t('gear.precisionPrune');
}

/** Precision dot with hover card. Card is portal-rendered at a fixed position so it escapes
 * the row's `overflow-hidden` (DPS bar clip); a plain CSS popover would be cropped at the edge. */
function PrecisionDot({ pct, targetError }: { pct: number; targetError?: number }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ top: r.top, left: r.right });
  };

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      className="flex items-center"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${precisionDotTone(pct)}`}
        aria-label={t('gear.precisionAccuracy', { pct: pct.toFixed(2) })}
      />
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', top: tip.top - 8, left: tip.left }}
            className="popover pointer-events-none z-[60] -translate-x-full -translate-y-full rounded-[6px] px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${precisionDotTone(pct)}`} />
              <span className="whitespace-nowrap text-[11px] font-semibold text-on-surface">
                {precisionBandLabel(pct, t)}
              </span>
            </div>
            <div className="mt-1 whitespace-nowrap font-mono text-[11px] tabular-nums leading-tight text-on-surface-variant">
              ±{pct.toFixed(2)}% <span className="text-on-surface-variant/50">· 95% CI</span>
            </div>
            {targetError != null && (
              <div className="whitespace-nowrap font-mono text-[11px] tabular-nums leading-tight text-on-surface-variant/60">
                target {targetError.toFixed(2)}%
              </div>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}

/** One simmed combination: what it changes, what it is worth, and the controls to
 *  compare or re-sim it. Shared by the ranked list and the per-source panels in the
 *  encounter summary, so a row reads the same wherever it is shown. */
export const ResultRow = memo(function ResultRow({
  result,
  rank,
  maxDps,
  baseDps,
  targetError,
  isBest,
  isSelected,
  onSelect,
  isCompareTarget,
  onCompare,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  sourceJobId,
}: {
  result: TopGearResult;
  rank?: number;
  maxDps: number;
  baseDps: number;
  targetError?: number;
  isBest: boolean;
  isSelected?: boolean;
  onSelect?: (name: string) => void;
  isCompareTarget?: boolean;
  onCompare?: (name: string) => void;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  /** When present, "Combo N" rows show a "Sim" button re-running the combo as a Quick Sim. */
  sourceJobId?: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);
  const barWidth = maxDps > 0 ? (result.dps / maxDps) * 100 : 0;
  const comboId = comboIdFromName(result.name);
  const showVerifyButton = !!sourceJobId && comboId !== null;

  const changedItems = result.items.filter(
    (item) => !item.is_kept && item.item_id > 0 && !item.type
  );
  const enchantGemItems = result.items.filter(
    (item) => item.type === 'enchant' || item.type === 'gem'
  );
  const isEquipped =
    (result.items.length === 0 || result.name.startsWith('Currently Equipped')) &&
    enchantGemItems.length === 0;
  const hasTalentBuild = !!result.talent_build;
  const hasFolioBuild = !!result.folio_build;
  const hasConsumables = !!result.consumables && Object.keys(result.consumables).length > 0;
  const changedSlots = new Set(changedItems.map((item) => item.slot));
  const showBothRings = changedSlots.has('finger1') || changedSlots.has('finger2');
  const showBothTrinkets = changedSlots.has('trinket1') || changedSlots.has('trinket2');

  const talentBadge = (
    <>
      {hasTalentBuild && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-quality-epic/10 px-1.5 py-px text-[11px] font-medium">
          {result.talent_spec && (
            <span className="text-quality-epic">{specDisplayName(result.talent_spec)}</span>
          )}
          <span className="text-quality-epic/70">{result.talent_build}</span>
        </span>
      )}
      {hasFolioBuild && (
        <span className="inline-flex shrink-0 items-center rounded bg-info/10 px-1.5 py-px text-[11px] font-medium text-info/80">
          {result.folio_build}
        </span>
      )}
      {hasConsumables && <ConsumableBadges consumables={result.consumables!} />}
    </>
  );

  const displayItems = result.items.filter((item) => {
    if (item.type) return false;
    if (!item.is_kept) return item.item_id > 0;
    if (showBothRings && (item.slot === 'finger1' || item.slot === 'finger2')) return true;
    if (showBothTrinkets && (item.slot === 'trinket1' || item.slot === 'trinket2')) return true;
    return false;
  });

  const deltaPct = baseDps > 0 ? (result.delta / baseDps) * 100 : 0;
  const deltaTone =
    result.delta > 0 ? 'text-positive' : result.delta < 0 ? 'text-negative' : 'text-fg-4';
  const deltaSubTone =
    result.delta > 0 ? 'text-positive/70' : result.delta < 0 ? 'text-negative/70' : 'text-fg-4';
  // Mock `.rank.best`: gold wash + 3px inset bar; selection and compare reuse the shape.
  const stateClass = isBest
    ? 'bg-gradient-to-r from-gold/10 to-transparent to-55% shadow-[inset_3px_0_0_theme(colors.gold.fill)]'
    : isSelected
      ? 'bg-gradient-to-r from-positive/10 to-transparent to-55% shadow-[inset_3px_0_0_theme(colors.positive)]'
      : isCompareTarget
        ? 'bg-gradient-to-r from-quality-rare/10 to-transparent to-55% shadow-[inset_3px_0_0_theme(colors.quality.rare)]'
        : 'hover:bg-overlay/[0.015]';

  return (
    <div
      onClick={() => onSelect?.(result.name)}
      className={`relative grid cursor-pointer items-center gap-4 border-b border-line/[0.06] px-6 py-3 transition-colors [contain-intrinsic-size:auto_62px] [content-visibility:auto] last:border-b-0 ${
        rank != null
          ? 'grid-cols-[48px_1fr_130px_120px_minmax(70px,auto)]'
          : 'grid-cols-[1fr_130px_120px_minmax(70px,auto)]'
      } ${stateClass}`}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-overlay/[0.02]"
        style={{ width: `${barWidth}%` }}
      />
      {rank != null && (
        <span
          className={`relative font-headline text-[15px] font-extrabold tabular-nums ${
            isBest ? 'text-gold' : 'text-fg-4'
          }`}
        >
          #{rank}
        </span>
      )}

      <div className="relative flex min-w-0 flex-wrap items-center gap-2">
        {(() => {
          const hasChangedItems = changedItems.length > 0 || enchantGemItems.length > 0;

          if (isEquipped) {
            return (
              <>
                <Pill>{t('gear.currentlyEquipped')}</Pill>
                {talentBadge}
              </>
            );
          }

          if (!hasChangedItems && (hasTalentBuild || hasFolioBuild || hasConsumables)) {
            return talentBadge;
          }

          return (
            <>
              {displayItems.map((item, index) => (
                <ItemTag
                  key={index}
                  item={item}
                  info={item.item_id > 0 ? itemInfoMap[item.item_id] : undefined}
                  enchant={item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined}
                  sourceInfo={item.source_item_id ? itemInfoMap[item.source_item_id] : undefined}
                  gems={appliedGems(item, gemInfoMap)}
                />
              ))}
              {enchantGemItems.map((item, index) => (
                <span
                  key={`eg-${index}`}
                  className={`inline-flex h-6 items-center gap-1 rounded-[5px] px-[9px] text-[12.5px] font-semibold ${
                    item.type === 'enchant' ? 'bg-ench/10 text-ench' : gemBadgeClass(item.name)
                  }`}
                >
                  {item.name || (item.type === 'gem' ? 'Gem' : 'Enchant')}
                </span>
              ))}
              {talentBadge}
            </>
          );
        })()}

        {isBest && <Pill variant="gold">{t('gear.best')}</Pill>}
      </div>

      <div
        className={`relative text-right font-headline text-sm font-extrabold tabular-nums ${deltaTone}`}
      >
        {result.delta > 0
          ? `+${Math.round(result.delta).toLocaleString()}`
          : result.delta < 0
            ? Math.round(result.delta).toLocaleString()
            : '—'}
        {baseDps > 0 && (
          <small className={`block font-sans text-[11.5px] font-semibold ${deltaSubTone}`}>
            {result.delta > 0 ? '+' : ''}
            {deltaPct.toFixed(2)}%
          </small>
        )}
      </div>

      <div className="relative flex items-center justify-end gap-1.5 font-headline text-[15px] font-extrabold tabular-nums">
        {Math.round(result.dps).toLocaleString()}
        {result.precision_pct != null && (
          <PrecisionDot pct={result.precision_pct} targetError={targetError} />
        )}
      </div>

      <div className="relative flex items-center justify-end gap-1">
        {onCompare && !isEquipped && (
          <Button
            variant="text"
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              onCompare(result.name);
            }}
            title={t('gear.compareRowTitle')}
            className={isCompareTarget ? '!text-info' : 'hover:!text-info'}
          >
            {t('gear.compareVs')}
          </Button>
        )}
        {showVerifyButton && (
          <Button
            variant="text"
            onClick={async (e: MouseEvent) => {
              e.stopPropagation();
              if (!sourceJobId || comboId == null || verifying) return;
              setVerifying(true);
              try {
                const newId = await simRow(sourceJobId, comboId);
                router.push(`/sim/${newId}`);
              } catch {
                setVerifying(false);
              }
            }}
            disabled={verifying}
            title={t('gear.verifyRowTitle')}
          >
            {verifying ? '…' : 'Sim'}
          </Button>
        )}
      </div>
    </div>
  );
});

function ItemTag({
  item,
  info,
  enchant,
  sourceInfo,
  gems,
}: {
  item: ResultItem;
  info?: ItemInfo;
  enchant?: EnchantInfo;
  /** The drop a catalyst row converts, so the CAT pill can name where it came from. */
  sourceInfo?: ItemInfo;
  /** Gems the drop is simmed with, one per socket. */
  gems?: GemInfo[];
}) {
  const { t, locale } = useLanguage();
  useItemNames();

  const qualityColor = info ? QUALITY_COLORS[info.quality] || QUALITY_COLORS[1] : QUALITY_COLORS[1];
  const name = localizedItemName(
    item.item_id,
    info?.name || item.name || `Item ${item.item_id}`,
    locale
  );
  const icon = info?.icon || 'inv_misc_questionmark';
  const wowheadData = item.item_id > 0 ? getWowheadData(item) : undefined;
  const slotName = SLOT_LABELS[item.slot] || item.slot;
  // A Void Forged row points `source_item_id` at itself, so only a catalyst has
  // an origin worth naming.
  const sourceName =
    item.is_catalyst && item.source_item_id
      ? localizedItemName(item.source_item_id, sourceInfo?.name || '', locale)
      : '';

  const href = item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined;

  return (
    <div
      className={`inline-flex min-w-0 items-center gap-[9px] rounded-[7px] border border-line/[0.06] bg-surface-container-high py-1 pl-1 pr-3 ${
        item.is_kept ? 'opacity-40' : ''
      }`}
    >
      <a
        href={href}
        data-wowhead={wowheadData}
        className="relative block h-[22px] w-[22px] shrink-0 overflow-hidden rounded-[4px] border"
        style={{ borderColor: qualityColor }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          {...iconProps(icon)}
          alt=""
          width={22}
          height={22}
          className="h-full w-full"
          loading="lazy"
        />
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
      </a>
      <div className="min-w-0">
        <a
          href={href}
          data-wowhead={wowheadData}
          className="block max-w-[240px] truncate text-[13px] font-semibold no-underline"
          style={{ color: qualityColor }}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
          }}
        >
          {name}
        </a>
        <div className="flex flex-wrap items-center gap-x-1 text-[11.5px] text-outline">
          <span>
            {slotName}
            {item.ilevel > 0 && ` · ${item.ilevel}`}
          </span>
          {item.is_void_forge && (
            <Pill variant="epic" size="sm" className="shrink-0">
              {t('loot.voidforged')}
            </Pill>
          )}
          {item.is_catalyst && (
            <span
              title={sourceName ? t('gear.catalystFrom', { name: sourceName }) : undefined}
              className="inline-flex shrink-0"
            >
              <Pill variant="info" size="sm">
                {t('loot.catalyst')}
                {sourceName && (
                  <span className="max-w-[170px] truncate font-sans font-medium normal-case tracking-normal text-info/70">
                    {sourceName}
                  </span>
                )}
              </Pill>
            </span>
          )}
          {gems?.map((gem, index) => (
            <span
              key={`${gem.gem_id}-${index}`}
              title={localizedGemName(gem, locale)}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm ring-1 ring-line/15"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                {...iconProps(gem.icon)}
                alt=""
                width={16}
                height={16}
                className="h-full w-full"
                loading="lazy"
              />
            </span>
          ))}
          {item.upgrade_levels ? (
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-positive">
              +{item.upgrade_levels}
            </span>
          ) : item.origin === 'vault' ? (
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-warning">
              V
            </span>
          ) : item.origin === 'loot' ? (
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-info">
              L
            </span>
          ) : null}
          {enchant?.name && (
            <span
              className="max-w-[140px] truncate text-ench"
              title={localizedEnchantName(enchant, locale)}
            >
              · {localizedEnchantName(enchant, locale)}
            </span>
          )}
          {item.embellishment && (
            <span
              className="max-w-[140px] truncate text-quality-epic/80"
              title={item.embellishment.name}
            >
              · {item.embellishment.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The consumables a combo swapped in for the Sim settings ones. Rendered only
 *  on rows that changed some, so the lookup isn't subscribed per row. */
function ConsumableBadges({ consumables }: { consumables: Record<string, string> }) {
  const lookup = useConsumableLookup();
  return (
    <>
      {Object.entries(consumables).map(([slot, value]) => {
        const entry = lookup.get(value);
        return (
          <span
            key={slot}
            title={entry?.name ?? value}
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[5px] bg-overlay/[0.06] px-[7px] text-[12px] font-semibold text-on-surface"
          >
            {entry?.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img {...iconProps(entry.icon)} alt="" className="h-4 w-4 rounded-[3px]" />
            )}
            {entry?.shortName || entry?.name || value}
          </span>
        );
      })}
    </>
  );
}
