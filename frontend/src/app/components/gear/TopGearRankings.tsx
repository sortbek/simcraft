'use client';

import { useRouter } from 'next/navigation';
import { memo, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { simRow } from '../../lib/api';
import { SLOT_LABELS, specDisplayName } from '../../lib/types';
import {
  QUALITY_COLORS,
  getIconUrl,
  getWowheadData,
  getWowheadUrl,
  localizedEnchantName,
  localizedItemName,
  toGemIdList,
  useItemNames,
} from '../../lib/useItemInfo';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import type { GroupMode, ResultItem, TopGearResult } from './topGearResultsTypes';
import { gemBadgeClass, groupResults } from './topGearResultsUtils';

/** Extract the numeric combo id from a "Combo N" result name. Returns null
 * for any other shape (e.g. "Currently Equipped"). */
function comboIdFromName(name: string): number | null {
  const match = name.match(/^Combo (\d+)$/);
  return match ? Number(match[1]) : null;
}

/** Dot fill for a precision value (95% CI half-width as % of mean) — how
 * trustworthy the displayed DPS is, not what was targeted. Greener = tighter.
 *   ≤0.5% → green     (final-pass precision)
 *   ≤1.0% → emerald   (refine band)
 *   ≤2.0% → yellow    (coarse band)
 *   ≤4.0% → orange    (probe / rough)
 *   >4.0% → red       (early-stage prune, treat with caution) */
function precisionDotTone(pct: number): string {
  if (pct <= 0.5) return 'bg-emerald-400';
  if (pct <= 1.0) return 'bg-emerald-500';
  if (pct <= 2.0) return 'bg-yellow-400';
  if (pct <= 4.0) return 'bg-orange-400';
  return 'bg-red-500';
}

/** Short band name shown as the precision tooltip header (mirrors the dot tone). */
function precisionBandLabel(pct: number): string {
  if (pct <= 0.5) return 'Final-pass precision';
  if (pct <= 1.0) return 'Refine band';
  if (pct <= 2.0) return 'Coarse band';
  if (pct <= 4.0) return 'Probe / rough';
  return 'Early-stage prune';
}

/** A precision dot with a styled hover card. The card is portal-rendered at a
 * fixed position so it escapes the row's `overflow-hidden` (the DPS bar clip);
 * a plain CSS popover would be cropped at the row edge. */
function PrecisionDot({ pct, targetError }: { pct: number; targetError?: number }) {
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
        aria-label={`accuracy ±${pct.toFixed(2)} percent`}
      />
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', top: tip.top - 8, left: tip.left }}
            className="pointer-events-none z-[60] -translate-x-full -translate-y-full rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-2 shadow-xl"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${precisionDotTone(pct)}`} />
              <span className="whitespace-nowrap text-[11px] font-semibold text-on-surface">
                {precisionBandLabel(pct)}
              </span>
            </div>
            <div className="mt-1 whitespace-nowrap font-mono text-[11px] leading-tight tabular-nums text-on-surface-variant">
              ±{pct.toFixed(2)}% <span className="text-on-surface-variant/50">· 95% CI</span>
            </div>
            {targetError != null && (
              <div className="whitespace-nowrap font-mono text-[11px] leading-tight tabular-nums text-on-surface-variant/60">
                target {targetError.toFixed(2)}%
              </div>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}

/** The result page only ever surfaces the top N rows — past ~10 the deltas
 * dwindle into noise of the per-row CI and adding more clutters the UI
 * without changing decisions. Grouped views (by slot/boss) are naturally
 * bounded by group size so they don't apply this cap. */
const MAX_VISIBLE = 10;

interface TopGearRankingsProps {
  results: TopGearResult[];
  maxDps: number;
  baseDps: number;
  /** Configured target_error (%), shown in the per-row precision tooltip. */
  targetError?: number;
  hasEncounterData: boolean;
  groupMode: GroupMode;
  onGroupModeChange: (mode: GroupMode) => void;
  selectedResultName: string | null;
  onSelectResult: (name: string) => void;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  sourceJobId?: string;
  sourceIsStreamed?: boolean;
}

export default function TopGearRankings({
  results,
  maxDps,
  baseDps,
  targetError,
  hasEncounterData,
  groupMode,
  onGroupModeChange,
  selectedResultName,
  onSelectResult,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  sourceJobId,
  sourceIsStreamed,
}: TopGearRankingsProps) {
  const { t } = useLanguage();
  const grouped = useMemo(() => groupResults(results, groupMode), [results, groupMode]);
  const verifyEnabled = !!sourceJobId && !!sourceIsStreamed;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">
          {t('gear.rankings')}
        </p>
        <div className="flex items-center gap-3">
          {hasEncounterData && (
            <div className="flex gap-1">
              {(
                [
                  ['rank', t('gear.byRank')],
                  ['slot', t('gear.bySlot')],
                  ['encounter', t('gear.byBoss')],
                ] as [GroupMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => onGroupModeChange(mode)}
                  className={`rounded px-2.5 py-1 text-[13px] font-medium transition-all ${
                    groupMode === mode
                      ? 'bg-white text-black'
                      : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="font-mono text-[13px] text-muted">
            {t('gear.resultsCount', { count: results.length })}
          </span>
        </div>
      </div>

      {(groupMode === 'encounter' || groupMode === 'slot') && grouped ? (
        <div className="space-y-6">
          {grouped.map(([groupKey, group]) => {
            const bestDelta = Math.max(...group.map((result) => result.delta));
            const avgDelta =
              group.length > 0
                ? group.reduce((sum, result) => sum + Math.max(0, result.delta), 0) / group.length
                : 0;
            const groupLabel = groupMode === 'slot' ? SLOT_LABELS[groupKey] || groupKey : groupKey;

            return (
              <div key={groupKey}>
                <div className="mb-3 flex items-center justify-between border-b border-outline-variant/20 pb-2">
                  <div className="flex items-center gap-3">
                    <span className="font-headline text-[14px] font-bold text-on-surface">
                      {groupLabel}
                    </span>
                    <span className="font-mono text-[12px] text-muted">
                      {t('gear.itemsCount', { count: group.length })}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className="text-on-surface-variant/60">
                      {t('gear.expectedUpgrade')}
                      <span
                        className={`font-bold ${avgDelta > 0 ? 'text-emerald-400' : 'text-muted'}`}
                      >
                        {avgDelta > 0 ? `+${((avgDelta / baseDps) * 100).toFixed(2)}%` : '--'}
                      </span>
                    </span>
                    <span className="text-on-surface-variant/60">
                      {t('gear.bestUpgrade')}
                      <span
                        className={`font-bold ${bestDelta > 0 ? 'text-emerald-400' : 'text-muted'}`}
                      >
                        {bestDelta > 0 ? `+${((bestDelta / baseDps) * 100).toFixed(2)}%` : '--'}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  {group.map((result) => (
                    <ResultRow
                      key={result.name}
                      result={result}
                      maxDps={maxDps}
                      baseDps={baseDps}
                      isBest={result === results[0] && result.delta > 0}
                      isSelected={result.name === (selectedResultName || results[0]?.name)}
                      onSelect={onSelectResult}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                      targetError={targetError}
                      sourceJobId={verifyEnabled ? sourceJobId : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <RankedResults
          results={results}
          maxDps={maxDps}
          baseDps={baseDps}
          targetError={targetError}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
          selectedResultName={selectedResultName}
          onSelectResult={onSelectResult}
          sourceJobId={verifyEnabled ? sourceJobId : undefined}
        />
      )}
    </div>
  );
}

function RankedResults({
  results,
  maxDps,
  baseDps,
  targetError,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  selectedResultName,
  onSelectResult,
  sourceJobId,
}: {
  results: TopGearResult[];
  maxDps: number;
  baseDps: number;
  targetError?: number;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  selectedResultName: string | null;
  onSelectResult: (name: string) => void;
  sourceJobId?: string;
}) {
  const visible = results.slice(0, MAX_VISIBLE);

  return (
    <div className="space-y-1">
      {visible.map((result, idx) => (
        <ResultRow
          key={result.name}
          result={result}
          rank={idx + 1}
          maxDps={maxDps}
          baseDps={baseDps}
          targetError={targetError}
          isBest={idx === 0 && result.delta > 0}
          isSelected={result.name === (selectedResultName || results[0]?.name)}
          onSelect={onSelectResult}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
          sourceJobId={sourceJobId}
        />
      ))}
    </div>
  );
}

const ResultRow = memo(function ResultRow({
  result,
  rank,
  maxDps,
  baseDps,
  targetError,
  isBest,
  isSelected,
  onSelect,
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
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  /** When present, the row shows a "Sim" button that re-runs this combo as
   * a high-precision Quick Sim. Omitted for non-streamed source jobs. */
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
  const changedSlots = new Set(changedItems.map((item) => item.slot));
  const showBothRings = changedSlots.has('finger1') || changedSlots.has('finger2');
  const showBothTrinkets = changedSlots.has('trinket1') || changedSlots.has('trinket2');

  const talentBadge = hasTalentBuild ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-purple-500/10 px-1.5 py-px text-[11px] font-medium">
      {result.talent_spec && (
        <span className="text-purple-300">{specDisplayName(result.talent_spec)}</span>
      )}
      <span className="text-purple-400/70">{result.talent_build}</span>
    </span>
  ) : null;

  const displayItems = result.items.filter((item) => {
    if (item.type) return false;
    if (!item.is_kept) return item.item_id > 0;
    if (showBothRings && (item.slot === 'finger1' || item.slot === 'finger2')) return true;
    if (showBothTrinkets && (item.slot === 'trinket1' || item.slot === 'trinket2')) return true;
    return false;
  });

  return (
    <div
      onClick={() => onSelect?.(result.name)}
      className={`relative cursor-pointer overflow-hidden rounded-lg transition-colors hover:bg-white/[0.04] ${
        isSelected && !isBest
          ? 'bg-emerald-500/[0.04] ring-1 ring-emerald-500/50'
          : isBest
            ? `ring-1 ring-gold/30 ${isSelected ? 'bg-gold/[0.05]' : 'bg-transparent'}`
            : isEquipped
              ? 'ring-1 ring-white/5'
              : ''
      }`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-white/[0.02]"
        style={{ width: `${barWidth}%` }}
      />
      <div className="relative flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {rank != null && (
            <span className="w-5 shrink-0 text-right font-mono text-[12px] tabular-nums text-on-surface-variant/50">
              {rank}
            </span>
          )}

          {(() => {
            const hasChangedItems = changedItems.length > 0 || enchantGemItems.length > 0;

            if (isEquipped) {
              return (
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-muted">{t('gear.currentlyEquipped')}</span>
                  {talentBadge}
                </div>
              );
            }

            if (!hasChangedItems && hasTalentBuild) {
              return talentBadge;
            }

            return (
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {displayItems.map((item, index) => (
                  <ItemTag
                    key={index}
                    item={item}
                    info={item.item_id > 0 ? itemInfoMap[item.item_id] : undefined}
                    enchant={item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined}
                    gem={item.gem_id ? gemInfoMap[item.gem_id] : undefined}
                  />
                ))}
                {enchantGemItems.map((item, index) => (
                  <span
                    key={`eg-${index}`}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[13px] font-medium ${
                      item.type === 'enchant'
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : gemBadgeClass(item.name)
                    }`}
                  >
                    {item.name || (item.type === 'gem' ? 'Gem' : 'Enchant')}
                  </span>
                ))}
                {talentBadge}
              </div>
            );
          })()}

          {isBest && (
            <span className="shrink-0 rounded bg-gold/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold">
              {t('gear.best')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={`flex items-center gap-1.5 font-headline font-mono text-[15px] tabular-nums ${
              result.delta > 0
                ? 'text-emerald-400'
                : result.delta < 0
                  ? 'text-red-400'
                  : 'text-muted'
            }`}
          >
            <span>
              {result.delta > 0
                ? `+${Math.round(result.delta).toLocaleString()}`
                : result.delta < 0
                  ? Math.round(result.delta).toLocaleString()
                  : '--'}
            </span>
            {result.delta !== 0 && baseDps > 0 && (
              <span className="text-xs opacity-70">
                ({result.delta > 0 ? '+' : ''}
                {((result.delta / baseDps) * 100).toFixed(1)}%)
              </span>
            )}
          </span>
          <span className="flex w-20 items-center justify-end gap-1.5">
            <span className="font-mono text-sm tabular-nums text-on-surface">
              {Math.round(result.dps).toLocaleString()}
            </span>
            {result.precision_pct != null && (
              <PrecisionDot pct={result.precision_pct} targetError={targetError} />
            )}
          </span>
          {showVerifyButton && (
            <button
              onClick={async (e) => {
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
              title="Re-run this row as a high-precision Quick Sim"
              className="rounded border border-outline-variant/20 bg-surface-container-high/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant transition-colors hover:bg-primary-container/30 hover:text-primary disabled:opacity-50"
            >
              {verifying ? '…' : 'Sim'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

function ItemTag({
  item,
  info,
  enchant,
}: {
  item: ResultItem;
  info?: ItemInfo;
  enchant?: EnchantInfo;
  gem?: GemInfo;
}) {
  const { locale } = useLanguage();
  useItemNames();

  const qualityColor = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = localizedItemName(
    item.item_id,
    info?.name || item.name || `Item ${item.item_id}`,
    locale
  );
  const icon = info?.icon || 'inv_misc_questionmark';
  const wowheadData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, toGemIdList(item))
      : undefined;
  const slotName = SLOT_LABELS[item.slot] || item.slot;

  return (
    <div
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
        item.is_kept ? 'opacity-40' : 'bg-white/[0.04]'
      }`}
    >
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
        data-wowhead={wowheadData}
        className="block h-4 w-4 shrink-0 overflow-hidden rounded-sm"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={16}
          height={16}
          className="h-full w-full"
          loading="lazy"
        />
      </a>
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
        data-wowhead={wowheadData}
        className="max-w-[120px] truncate text-[13px] font-medium no-underline"
        style={{ color: qualityColor }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
        }}
      >
        {name}
      </a>
      <span className="text-[11px] text-muted">({slotName})</span>
      {item.upgrade_levels ? (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
          +{item.upgrade_levels}
        </span>
      ) : item.origin === 'vault' ? (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-400">
          V
        </span>
      ) : item.origin === 'loot' ? (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-sky-400">
          L
        </span>
      ) : null}
      {enchant?.name && (
        <span
          className="max-w-[70px] truncate text-[11px] text-emerald-400/70"
          title={localizedEnchantName(enchant, locale)}
        >
          {localizedEnchantName(enchant, locale)}
        </span>
      )}
    </div>
  );
}
