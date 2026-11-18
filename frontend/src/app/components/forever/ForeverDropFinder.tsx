'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import Checkbox from '../ui/Checkbox';
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

/** Where a source sits: an instance's entry level, else the highest level its gear for you needs.
 *  0 when nothing it has for you names a level. */
const entryLevel = (s: ForeverDropSource) => s.level || s.max_level || 0;

/** By level, sources without one last, then by name. */
function bySourceOrder(a: ForeverDropSource, b: ForeverDropSource) {
  return (entryLevel(a) || 99) - (entryLevel(b) || 99) || a.name.localeCompare(b.name);
}

const bossKey = (source: string, from: string) => `boss:${source}:${from}`;
const rowUid = (source: string, itemId: number) => `${source}|${itemId}`;

/** One line per source: checkbox, name, level. The rest is in its tooltip. */
function SourceRow({
  source,
  checked,
  onToggle,
}: {
  source: ForeverDropSource;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const fits = source.count > 0;
  const standing = (s: string) => t(`forever.drops.standing.${s}`);
  const standings = source.standings
    ? source.standings[0] === source.standings[1]
      ? standing(source.standings[0])
      : t('forever.drops.standingRange', {
          from: standing(source.standings[0]),
          to: standing(source.standings[1]),
        })
    : '';
  const items = fits
    ? t('forever.drops.itemsForYou', { count: source.count })
    : source.total === 0
      ? t('forever.drops.noneKnown')
      : t('forever.drops.noneFit');
  const level = entryLevel(source);
  return (
    <button
      type="button"
      disabled={!fits}
      onClick={onToggle}
      aria-pressed={checked}
      title={[source.name, source.zone, standings, items].filter(Boolean).join(' · ')}
      className="flex w-full break-inside-avoid items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-left transition-colors hover:bg-surface-container-high disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Checkbox checked={checked} size="sm" aria-label={source.name} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13.5px]',
          checked ? 'text-on-surface' : 'text-on-surface-variant'
        )}
      >
        {/* A vendor's <title> is in the tooltip. */}
        {source.name.replace(/\s*<.*>$/, '')}
        {source.new && (
          <span
            title={t('forever.drops.new')}
            className="ml-[7px] inline-block h-1.5 w-1.5 rounded-full bg-primary align-[2px]"
          />
        )}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-fg-4">{level || ''}</span>
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
  const [showLater, setShowLater] = useState(false);
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
  // Gear for later: nothing wearable yet, or an instance the character is below.
  const usable = (g: ForeverDropSource) => g.count > 0 && entryLevel(g) <= (summary?.level ?? 0);
  const now = inCategory.filter(usable);
  const later = inCategory.filter((g) => !usable(g));
  const query = search.trim().toLocaleLowerCase();
  const listed = (showLater ? [...now, ...later] : now).filter(
    (g) => !query || g.name.toLocaleLowerCase().includes(query)
  );

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
    setShowLater(false);
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
              <div className="-mx-8 !mt-3 flex px-8">
                <CategorySelector
                  category={tabKey(category)}
                  onChange={selectCategory}
                  dungeonCats={tabs}
                  className="min-w-0 flex-1"
                />
                {inCategory.length > SEARCH_ABOVE && (
                  <div className="flex items-center border-b border-line/[0.06] pl-4">
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('forever.drops.searchSources')}
                      className="w-44 border-b border-line/15 bg-transparent py-1.5 text-[13px] text-on-surface placeholder:text-fg-4 focus:border-primary focus:outline-none"
                    />
                  </div>
                )}
              </div>
              <div className="card p-3">
                {listed.length > 0 ? (
                  <div className="columns-1 gap-2 sm:columns-2 xl:columns-3">
                    {listed.map((g) => (
                      <SourceRow
                        key={g.key}
                        source={g}
                        checked={pool.has(g.key)}
                        onToggle={() => setPool((p) => toggleIn(p, [g.key]))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-1.5 text-sm text-outline">
                    {query ? t('loot.noItemsMatch') : t('forever.drops.nothingHere')}
                  </p>
                )}
                {later.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowLater((v) => !v)}
                    className="mx-2 mt-2 text-[12.5px] text-fg-4 transition-colors hover:text-on-surface-variant"
                  >
                    {showLater
                      ? t('forever.drops.hideLater')
                      : t('forever.drops.showLater', { count: later.length })}
                  </button>
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
