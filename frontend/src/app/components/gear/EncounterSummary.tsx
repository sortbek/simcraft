'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import {
  getWowheadData,
  getWowheadUrl,
  iconProps,
  localizedItemName,
  useItemNames,
  type EnchantInfo,
  type GemInfo,
  type ItemInfo,
} from '../../lib/useItemInfo';
import { useWowheadTooltips, wowheadKeyFor } from '../../lib/useWowheadTooltips';
import Select from '../loot/Select';
import { ResultRow } from './ResultRow';
import {
  appliedGems,
  summarizeByEncounter,
  type EncounterSummaryRow,
  type SummarySort,
} from './topGearResultsUtils';
import type { TopGearResult } from './topGearResultsTypes';

/** Below this an item is noise rather than an upgrade, so it stays dimmed. */
const NOTABLE_PCT = 0.05;

function formatDelta(delta: number): string {
  return `${delta >= 0 ? '+' : '−'}${Math.round(Math.abs(delta)).toLocaleString()}`;
}

function DeltaMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-right">
      <div
        className={`font-mono text-[15px] font-bold tabular-nums ${
          value > 0 ? 'text-positive' : 'text-outline'
        }`}
      >
        {formatDelta(value)}
      </div>
      <div className="lbl">{label}</div>
    </div>
  );
}

/** One drop from this source: its icon, what it is worth as a percentage, and
 *  the marks that tell it apart — the gems it is simmed with, and for a
 *  conversion the tag plus a sub-icon of the drop it was made from. */
function ItemPip({
  result,
  baseDps,
  itemInfoMap,
  gemInfoMap,
}: {
  result: TopGearResult;
  baseDps: number;
  itemInfoMap: Record<number, ItemInfo>;
  gemInfoMap: Record<number, GemInfo>;
}) {
  const { t, locale } = useLanguage();
  const item = result.items[0];
  const info = item ? itemInfoMap[item.item_id] : undefined;
  const pct = baseDps > 0 ? (result.delta / baseDps) * 100 : 0;
  const notable = pct >= NOTABLE_PCT;
  const source = item?.is_catalyst && item.source_item_id ? item.source_item_id : 0;
  const sourceInfo = source ? itemInfoMap[source] : undefined;
  const sourceName = source ? localizedItemName(source, sourceInfo?.name || '', locale) : '';
  const gems = item ? appliedGems(item, gemInfoMap) : [];
  const badge = item?.is_catalyst
    ? { label: t('gear.catalystShort'), tone: 'bg-quality-rare text-on-badge' }
    : item?.is_void_forge
      ? { label: t('gear.voidForgeShort'), tone: 'bg-quality-epic text-on-badge' }
      : null;
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1">
      {/* The whole pip dims together — a drop that is not an upgrade should not
          advertise its gems or its conversion any brighter than itself. */}
      <div className={`relative ${notable ? '' : 'opacity-35'}`}>
        <a
          href={item && item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
          data-wowhead={item && item.item_id > 0 ? getWowheadData(item) : undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.preventDefault()}
          className={`block h-8 w-8 overflow-hidden rounded ${
            notable ? 'ring-1 ring-gold/40' : ''
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            {...iconProps(info?.icon || 'inv_misc_questionmark')}
            alt=""
            width={32}
            height={32}
            className="h-full w-full"
            loading="lazy"
          />
        </a>
        {gems.length > 0 && (
          <span className="absolute -bottom-1 -left-1 flex gap-px">
            {gems.slice(0, 3).map((gem, index) => (
              <a
                key={`${gem.gem_id}-${index}`}
                href={getWowheadUrl(gem.gem_id, locale)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.preventDefault()}
                className="block h-3 w-3 overflow-hidden rounded-[2px] ring-1 ring-shade/70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  {...iconProps(gem.icon)}
                  alt=""
                  width={12}
                  height={12}
                  className="h-full w-full"
                  loading="lazy"
                />
              </a>
            ))}
          </span>
        )}
        {source > 0 && (
          <a
            href={getWowheadUrl(source, locale)}
            title={sourceName ? t('gear.catalystFrom', { name: sourceName }) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.preventDefault()}
            className="absolute -bottom-1 -right-1 block h-3.5 w-3.5 overflow-hidden rounded-[2px] ring-1 ring-quality-rare/70"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...iconProps(sourceInfo?.icon || 'inv_misc_questionmark')}
              alt=""
              width={14}
              height={14}
              className="h-full w-full"
              loading="lazy"
            />
          </a>
        )}
        {badge && (
          <span
            className={`pointer-events-none absolute -right-1 -top-1 rounded-sm px-0.5 text-[7px] font-bold uppercase leading-[1.6] tracking-tight ${badge.tone}`}
          >
            {badge.label}
          </span>
        )}
      </div>
      <span
        className={`font-mono text-[11px] tabular-nums ${
          notable ? 'text-positive' : 'text-outline'
        }`}
      >
        {pct >= 0 ? '' : '−'}
        {Math.abs(pct).toFixed(1)}%
      </span>
    </div>
  );
}

interface EncounterSummaryProps {
  results: TopGearResult[];
  baseDps: number;
  maxDps: number;
  targetError?: number;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  bestResultName?: string;
  selectedResultName: string | null;
  onSelectResult: (name: string) => void;
  compareResultName: string | null;
  onCompareResult: (name: string) => void;
  sourceJobId?: string;
}

/** Which source is worth your time, across everything it can drop. Ranks by the
 *  average of its upgrades rather than by its single best, so one lucky item
 *  does not make a thin loot table look rich. Each source opens to the sims
 *  behind it. */
export default function EncounterSummary({
  results,
  baseDps,
  maxDps,
  targetError,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  bestResultName,
  selectedResultName,
  onSelectResult,
  compareResultName,
  onCompareResult,
  sourceJobId,
}: EncounterSummaryProps) {
  const { t } = useLanguage();
  useItemNames();
  const [sort, setSort] = useState<SummarySort>('expected');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Expanding a source mounts fresh anchors, so the tooltips need a refresh the
  // info maps alone would not trigger.
  useWowheadTooltips([
    wowheadKeyFor({ item: itemInfoMap, enchant: enchantInfoMap, gem: gemInfoMap }),
    [...expanded].sort().join('|'),
  ]);
  const rows = useMemo(
    () => summarizeByEncounter(results, sort, baseDps),
    [results, sort, baseDps]
  );
  if (rows.length < 2) return null;

  const toggle = (encounter: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(encounter)) next.add(encounter);
      return next;
    });

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-xs font-medium uppercase tracking-widest text-outline">
          {t('gear.sourceSummary')}
        </p>
        <div className="w-52">
          <Select
            value={sort}
            onChange={(value: SummarySort) => setSort(value)}
            options={[
              { value: 'expected' as SummarySort, label: t('gear.expectedValue') },
              { value: 'best' as SummarySort, label: t('gear.bestValue') },
            ]}
          />
        </div>
      </div>

      <div className="divide-y divide-outline-variant/15">
        {rows.map((row: EncounterSummaryRow) => {
          const open = expanded.has(row.encounter);
          const panelId = `source-${row.encounter.replace(/\W+/g, '-')}`;
          return (
            <div key={row.encounter} className="py-3 first:pt-0">
              <div
                onClick={() => toggle(row.encounter)}
                className="flex cursor-pointer flex-wrap items-center gap-x-5 gap-y-3 rounded-lg px-1 transition-colors hover:bg-overlay/[0.03]"
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(row.encounter);
                  }}
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={t(open ? 'gear.collapseSource' : 'gear.expandSource', {
                    name: row.encounter,
                  })}
                  className="shrink-0 text-on-surface-variant/40 transition-colors hover:text-on-surface"
                >
                  <svg
                    className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
                <div className="min-w-[9rem] flex-1">
                  <div className="font-headline text-[14px] font-bold text-on-surface">
                    {row.encounter}
                  </div>
                  <div className="text-[11px] text-outline">
                    {row.instance || t('gear.itemsFromSource', { count: row.results.length })}
                  </div>
                </div>
                <div
                  onClick={(event) => event.stopPropagation()}
                  className="flex flex-wrap items-start gap-1.5"
                >
                  {row.results.map((result) => (
                    <ItemPip
                      key={result.name}
                      result={result}
                      baseDps={baseDps}
                      itemInfoMap={itemInfoMap}
                      gemInfoMap={gemInfoMap}
                    />
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-5">
                  <DeltaMetric value={row.expected} label={t('gear.expectedValue')} />
                  <DeltaMetric value={row.best} label={t('gear.bestValue')} />
                  <div className="w-10 text-center">
                    <div className="font-mono text-[15px] font-bold tabular-nums text-gold">
                      {row.priority}
                    </div>
                    <div className="lbl">{t('gear.priority')}</div>
                  </div>
                </div>
              </div>
              {open && (
                <div id={panelId} className="mt-2 space-y-1 pl-6">
                  {row.combos.map((result) => (
                    <ResultRow
                      key={result.name}
                      result={result}
                      maxDps={maxDps}
                      baseDps={baseDps}
                      targetError={targetError}
                      isBest={result.name === bestResultName}
                      isSelected={result.name === selectedResultName}
                      onSelect={onSelectResult}
                      isCompareTarget={result.name === compareResultName}
                      onCompare={onCompareResult}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                      sourceJobId={sourceJobId}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-center text-[11px] text-outline">{t('gear.summaryNote')}</p>
    </div>
  );
}
