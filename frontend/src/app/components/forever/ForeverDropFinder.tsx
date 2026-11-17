'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import Checkbox from '../ui/Checkbox';
import Pill from '../ui/Pill';
import CategorySelector from '../loot/CategorySelector';
import ItemTable from '../loot/ItemTable';
import SlotFilter from '../loot/SlotFilter';
import SourceFilter from '../loot/SourceFilter';
import type { LootItemRowModel } from '../loot/lootItemRowModel';
import type { PoolSource } from '../loot/lootSources';
import { compareSlots } from '../loot/slotOrder';
import { cn } from '../../lib/cn';
import { useLanguage } from '../../lib/i18n';
import { getForeverWowheadUrl } from '../../lib/useItemInfo';
import type { DungeonCategory } from '../../lib/types';
import { useSimContext } from '../sim-config/SimContext';
import ForeverFooter from './ForeverFooter';
import ForeverSettingsBlock from './ForeverSettingsBlock';
import ForeverTalentCard from './ForeverTalentCard';
import ForeverWarnings from './ForeverWarnings';
import { blockedReason } from './specs';
import type { ForeverDropSource } from './types';
import { useForeverBuffs } from './useForeverBuffs';
import { useForeverDropSources } from './useForeverDropSources';
import { useForeverImport } from './useForeverImport';
import { useForeverSettings } from './useForeverSettings';
import { useForeverSpec } from './useForeverSpec';
import { useForeverSubmit } from './useForeverSubmit';
import { useForeverTalents } from './useForeverTalents';

type Category = ForeverDropSource['category'];
const CATEGORIES: Category[] = [
  'dungeon',
  'raid',
  'quest',
  'reputation',
  'crafted',
  'vendor',
  'pvp',
  'world',
];
/** The category tabs are the retail Drop Finder's; its raid tab is keyed `raids`. */
const tabKey = (c: Category) => (c === 'raid' ? 'raids' : `forever-${c}`);
/** Above this many sources the picker gets a search box. */
const SEARCH_ABOVE = 12;

/** Sources with gear that fits first, then by level (an instance's entry level, else the lowest
 *  its items need), then by name. */
function bySourceOrder(a: ForeverDropSource, b: ForeverDropSource) {
  if (a.count > 0 !== b.count > 0) return a.count > 0 ? -1 : 1;
  const level = (s: ForeverDropSource) => s.level || (s.min_level ?? 0);
  return level(a) - level(b) || a.name.localeCompare(b.name);
}

const bossKey = (source: string, from: string) => `boss:${source}:${from}`;
const rowUid = (source: string, itemId: number) => `${source}|${itemId}`;

function SourceChip({
  source,
  checked,
  onToggle,
  level,
}: {
  source: ForeverDropSource;
  checked: boolean;
  onToggle: () => void;
  level: number;
}) {
  const { t } = useLanguage();
  const fits = source.count > 0;
  const levels =
    source.level > 0
      ? `L${source.level}`
      : fits && source.min_level != null && source.max_level != null
        ? source.min_level === source.max_level
          ? `L${source.min_level}`
          : `L${source.min_level}–${source.max_level}`
        : '';
  const standing = (s: string) => t(`forever.drops.standing.${s}`);
  const standings = source.standings
    ? source.standings[0] === source.standings[1]
      ? standing(source.standings[0])
      : t('forever.drops.standingRange', {
          from: standing(source.standings[0]),
          to: standing(source.standings[1]),
        })
    : '';
  const detail = [levels, source.zone, standings].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      disabled={!fits}
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left transition-colors',
        checked ? 'bg-gold/[0.08]' : 'hover:bg-surface-container-highest',
        !fits && 'cursor-default opacity-45 hover:bg-transparent'
      )}
    >
      <Checkbox checked={checked} size="sm" aria-label={source.name} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'truncate text-[13px] font-semibold',
              checked ? 'text-on-surface' : 'text-on-surface-variant'
            )}
          >
            {source.name}
          </span>
          {source.new && (
            <Pill size="sm" variant="info" className="shrink-0">
              {t('forever.drops.new')}
            </Pill>
          )}
        </span>
        {detail && (
          <span
            className={cn(
              'block truncate text-[11px] tabular-nums',
              source.level > level ? 'text-outline' : 'text-on-surface-variant'
            )}
          >
            {detail}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[11px] font-bold tabular-nums text-outline">
        {fits
          ? source.count
          : source.total === 0
            ? t('forever.drops.noneKnown')
            : t('forever.drops.noneFit')}
      </span>
    </button>
  );
}

export default function ForeverDropFinder() {
  const { simcInput } = useSimContext();
  const { t, locale } = useLanguage();
  const talents = useForeverTalents(simcInput);
  const { summary, error } = useForeverImport(simcInput, talents.edited);
  const { sources, error: sourcesError } = useForeverDropSources(simcInput);
  const settings = useForeverSettings();
  const [specKey, setSpecKey] = useForeverSpec(simcInput, summary?.spec_key ?? null);

  const [category, setCategory] = useState<Category>('dungeon');
  const [pool, setPool] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [excludedBosses, setExcludedBosses] = useState<Set<string>>(new Set());
  const [excludedSlots, setExcludedSlots] = useState<Set<string>>(new Set());
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setPool(new Set());
    setExcludedBosses(new Set());
    setExcludedSlots(new Set());
    setDeselected(new Set());
  }, [simcInput]);

  const groups = useMemo(() => sources?.groups ?? [], [sources]);
  const tabs = useMemo(
    () =>
      CATEGORIES.filter((c) => c !== 'raid' && groups.some((g) => g.category === c)).map((c) => ({
        cat: {
          key: tabKey(c),
          label: t(`forever.drops.category.${c}`),
          poolInstanceId: 0,
          defaultDifficulty: '',
          difficulties: [],
        } satisfies DungeonCategory,
        instances: [],
      })),
    [groups, t]
  );
  const inCategory = useMemo(
    () => groups.filter((g) => g.category === category).sort(bySourceOrder),
    [groups, category]
  );
  const fitting = inCategory.filter((g) => g.count > 0);
  const emptyCount = inCategory.length - fitting.length;
  const query = search.trim().toLocaleLowerCase();
  const listed = (showEmpty ? inCategory : fitting).filter(
    (g) => !query || g.name.toLocaleLowerCase().includes(query)
  );
  const pickedHere = fitting.filter((g) => pool.has(g.key)).length;

  // The picked sources, across every tab, in the order the server lists them.
  const picked = useMemo(() => groups.filter((g) => pool.has(g.key)), [groups, pool]);
  const poolSources: PoolSource[] = useMemo(
    () =>
      picked.map((g) => ({
        key: g.key,
        name: g.name,
        bosses: [...new Set(g.items.map((i) => i.from).filter(Boolean))].map((from) => ({
          key: bossKey(g.key, from),
          name: from,
        })),
      })),
    [picked]
  );
  const shownByBoss = useMemo(
    () =>
      picked.flatMap((g) =>
        g.items
          .filter((i) => !excludedBosses.has(bossKey(g.key, i.from)))
          .map((item) => ({ source: g, item }))
      ),
    [picked, excludedBosses]
  );
  const availableSlots = useMemo(
    () => [...new Set(shownByBoss.map((r) => r.item.slot))].sort(compareSlots),
    [shownByBoss]
  );
  const rows: LootItemRowModel[] = useMemo(
    () =>
      shownByBoss
        .filter((r) => !excludedSlots.has(r.item.slot))
        .map(({ source, item }) => {
          const uid = rowUid(source.key, item.item_id);
          return {
            uid,
            itemId: item.item_id,
            name: item.name,
            icon: item.icon,
            source: [source.name, item.from].filter(Boolean).join(' • '),
            sourceName: source.name,
            slot: item.slot,
            ilevel: item.ilevel,
            quality: item.quality,
            href: getForeverWowheadUrl('item', item.item_id, locale),
            tooltip: '',
            selected: !deselected.has(uid),
            offSpec: false,
            embellished: false,
            variants: {},
          };
        }),
    [shownByBoss, excludedSlots, deselected, locale]
  );
  const selectedRows = rows.filter((r) => r.selected);
  const itemCount = new Set(selectedRows.map((r) => r.itemId)).size;

  const blocked = summary ? blockedReason(summary.level, summary.has_sheet, specKey) : null;
  const buffs = useForeverBuffs((specKey && summary?.sim_options?.[specKey]) || null);
  const buildPayload = useCallback(
    () =>
      summary && !blocked && selectedRows.length > 0
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            talents_string: talents.edited ?? undefined,
            drops: selectedRows.map((r) => ({
              source: r.uid.slice(0, r.uid.lastIndexOf('|')),
              item_id: r.itemId,
            })),
          }
        : null,
    [
      summary,
      blocked,
      selectedRows,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.edited,
    ]
  );
  const {
    submit,
    submitting,
    error: submitError,
  } = useForeverSubmit('/api/forever/drop-finder', buildPayload);
  const buildComparePayload = useCallback(
    () =>
      summary && !blocked
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            builds: [
              {
                name: t('forever.exportedTalents'),
                talents_string: summary.exported_talents_string,
              },
              ...talents.builds,
            ],
          }
        : null,
    [
      summary,
      blocked,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.builds,
      t,
    ]
  );
  const compare = useForeverSubmit('/api/forever/talent-compare', buildComparePayload);

  const toggleIn = (set: Set<string>, keys: string[], on?: boolean) => {
    const next = new Set(set);
    const add = on ?? !keys.every((k) => next.has(k));
    for (const k of keys) {
      if (add) next.add(k);
      else next.delete(k);
    }
    return next;
  };
  const selectCategory = (key: string) => {
    const next = CATEGORIES.find((c) => tabKey(c) === key);
    if (!next) return;
    setCategory(next);
    setSearch('');
    setShowEmpty(false);
  };

  const status = blocked
    ? t(`forever.blocked.${blocked}`)
    : itemCount === 0
      ? t('forever.drops.pickSources')
      : t('forever.selectedCount', { count: itemCount });

  return (
    <>
      {error && <ErrorAlert message={error} />}
      {sourcesError && <ErrorAlert message={sourcesError} />}
      {summary && (
        <>
          <ForeverSettingsBlock
            {...settings}
            buffs={buffs}
            levelling={(summary?.level ?? 60) < 60}
          />
          <ForeverTalentCard
            summary={summary}
            specKey={specKey}
            onSpecChange={setSpecKey}
            talents={talents}
            compare={compare}
          />
          <ForeverWarnings warnings={summary.warnings} />
          {sources && !sources.available && (
            <p className="card px-6 py-5 text-sm text-outline">{t('forever.drops.unavailable')}</p>
          )}
          {sources?.available && (
            <>
              <CategorySelector
                category={tabKey(category)}
                onChange={selectCategory}
                dungeonCats={tabs}
                className="-mx-8 !mt-3 px-8"
              />
              <div className="card">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/[0.06] px-5 py-3">
                  <span className="lbl">{t('forever.drops.sources')}</span>
                  <Pill className="tabular-nums">
                    {pickedHere}/{fitting.length}
                  </Pill>
                  {inCategory.length > SEARCH_ABOVE && (
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('forever.drops.searchSources')}
                      className="input-field h-8 max-w-[240px] flex-[1_1_160px] py-0 !text-[13px]"
                    />
                  )}
                  <span className="ml-auto flex items-center gap-4">
                    {emptyCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowEmpty((v) => !v)}
                        className="text-xs text-on-surface-variant transition-colors hover:text-on-surface"
                      >
                        {showEmpty
                          ? t('forever.drops.hideEmpty')
                          : t('forever.drops.showEmpty', { count: emptyCount })}
                      </button>
                    )}
                    {fitting.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPool((p) =>
                            toggleIn(
                              p,
                              fitting.map((g) => g.key)
                            )
                          )
                        }
                        className="font-headline text-[10px] font-extrabold uppercase tracking-[0.12em] text-gold transition-colors hover:text-gold-light"
                      >
                        {pickedHere === fitting.length
                          ? t('dropFinder.deselectAll')
                          : t('dropFinder.selectAll')}
                      </button>
                    )}
                  </span>
                </div>
                {listed.length > 0 ? (
                  <div className="grid grid-cols-1 gap-0.5 p-2 sm:grid-cols-2 xl:grid-cols-3">
                    {listed.map((g) => (
                      <SourceChip
                        key={g.key}
                        source={g}
                        checked={pool.has(g.key)}
                        onToggle={() => setPool((p) => toggleIn(p, [g.key]))}
                        level={summary.level}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="px-5 py-4 text-sm text-outline">
                    {query ? t('loot.noItemsMatch') : t('forever.drops.nothingHere')}
                  </p>
                )}
              </div>
              {picked.length > 0 ? (
                <ItemTable
                  model={{ rows, embellishmentLimitReached: false }}
                  onToggle={(uid) => setDeselected((d) => toggleIn(d, [uid], !d.has(uid)))}
                  onSelectItems={(uids) => setDeselected((d) => toggleIn(d, uids, false))}
                  onClearItems={(uids) => setDeselected((d) => toggleIn(d, uids, true))}
                  filters={
                    <>
                      <SourceFilter
                        sources={poolSources}
                        excludedSources={excludedBosses}
                        toggleSource={(keys) => setExcludedBosses((e) => toggleIn(e, keys))}
                      />
                      <SlotFilter
                        availableSlots={availableSlots}
                        excludedSlots={excludedSlots}
                        toggleSlot={(slot) => setExcludedSlots((e) => toggleIn(e, [slot]))}
                        resetExcludedSlots={() => setExcludedSlots(new Set())}
                      />
                    </>
                  }
                />
              ) : (
                <p className="card px-6 py-5 text-sm text-outline">
                  {t('forever.drops.pickSourcesHint')}
                </p>
              )}
            </>
          )}
        </>
      )}
      <ErrorAlert message={submitError} />
      <ForeverFooter
        onSubmit={submit}
        submitting={submitting}
        disabled={!summary || !!blocked || itemCount === 0}
        label={t('button.findUpgrades')}
        status={summary ? status : null}
      />
    </>
  );
}
