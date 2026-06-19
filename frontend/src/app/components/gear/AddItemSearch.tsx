'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl, fetchJson, postJson } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { QUALITY_TEXT_CLASS, qualityBorderColor } from '../../lib/qualityColors';
import { detectClass, type UpgradeTracks } from '../loot/types';
import type { ResolvedItem } from '../../lib/types';

interface SearchItem {
  item_id: number;
  name: string;
  icon: string;
  inventory_type: number;
  quality: number;
  ilevel: number;
}

interface IlvlOption {
  ilvl: number;
  bonus_id: number;
}

export interface AddItemSearchProps {
  simcInput: string;
  /** Called with the backend-resolved items to merge into Top Gear state. */
  onItemsResolved: (items: ResolvedItem[]) => void;
}

const RESULT_LIMIT = 50;

const SLOT_LABELS: Record<number, string> = {
  1: 'Head',
  2: 'Neck',
  3: 'Shoulder',
  5: 'Chest',
  6: 'Waist',
  7: 'Legs',
  8: 'Feet',
  9: 'Wrist',
  10: 'Hands',
  11: 'Finger',
  12: 'Trinket',
  13: 'One-Hand',
  14: 'Off Hand',
  15: 'Ranged',
  16: 'Back',
  17: 'Two-Hand',
  20: 'Chest',
  21: 'Main Hand',
  22: 'Off Hand',
  23: 'Held',
  26: 'Ranged',
};

/** Distinct seasonal item levels (every upgrade-track level), highest first,
 *  each mapped to its track bonus id. */
function buildSeasonalIlvls(tracks: UpgradeTracks): IlvlOption[] {
  const byIlvl = new Map<number, number>();
  for (const levels of Object.values(tracks)) {
    for (const lvl of levels) if (!byIlvl.has(lvl.ilvl)) byIlvl.set(lvl.ilvl, lvl.bonus_id);
  }
  return [...byIlvl.entries()]
    .map(([ilvl, bonus_id]) => ({ ilvl, bonus_id }))
    .sort((a, b) => b.ilvl - a.ilvl);
}

export default function AddItemSearch({ simcInput, onItemsResolved }: AddItemSearchProps) {
  const { locale } = useLanguage();
  const className = useMemo(() => detectClass(simcInput), [simcInput]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [tracks, setTracks] = useState<UpgradeTracks>({});
  const [ilvl, setIlvl] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seasonal = useMemo(() => buildSeasonalIlvls(tracks), [tracks]);

  useEffect(() => {
    fetchJson<UpgradeTracks>(apiUrl('/api/upgrade-tracks'))
      .then(setTracks)
      .catch(() => {});
  }, []);

  // Default the item-level field to the season's max once tracks load.
  useEffect(() => {
    if (ilvl === null && seasonal.length > 0) setIlvl(seasonal[0].ilvl);
  }, [seasonal, ilvl]);

  // Debounced search; an AbortController drops stale responses.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const classParam = className ? `&class_name=${className}` : '';
    const timer = setTimeout(() => {
      fetchJson<{ items: SearchItem[] }>(
        apiUrl(
          `/api/items/search?q=${encodeURIComponent(q)}&locale=${locale}${classParam}&expansion=11`
        ),
        { signal: controller.signal }
      )
        .then((data) => setResults(data.items ?? []))
        .catch(() => {
          /* aborted or failed — leave previous results */
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, locale, className]);

  // The selected seasonal item level shown on cards and used on add.
  const effective = useMemo(
    () => seasonal.find((o) => o.ilvl === ilvl) ?? null,
    [ilvl, seasonal]
  );

  const handleAdd = useCallback(
    async (item: SearchItem) => {
      const option = effective;
      setError(null);
      setAdding(item.item_id);
      try {
        const res = await postJson<{ items: ResolvedItem[] }>('/api/top-gear/resolve-drops', {
          simc_input: simcInput,
          drop_items: [
            {
              item_id: item.item_id,
              name: item.name,
              icon: item.icon,
              inventory_type: item.inventory_type,
              ilevel: option?.ilvl ?? item.ilevel,
              bonus_ids: option?.bonus_id ? [option.bonus_id] : [],
            },
          ],
        });
        onItemsResolved(res.items);
        // Reset the search after a successful add — you rarely need two of the
        // same item, so clearing keeps the next search ready.
        setQuery('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add item');
      } finally {
        setAdding(null);
      }
    },
    [effective, simcInput, onItemsResolved]
  );

  const hasQuery = query.trim().length > 0;
  const capped = results.length >= RESULT_LIMIT;

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h3 className="font-headline text-base font-black uppercase tracking-tight text-on-surface">
          Item Search
        </h3>
        <p className="mt-1 text-xs text-on-surface-variant/70">
          Search any current-season item your class can use and add it at a chosen item level. Lets
          you sim gear you don&apos;t own yet.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            Name
          </label>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/55"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="6.5" cy="6.5" r="4.5" />
              <path d="M10 10l4 4" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by item name or id"
              className="h-10 w-full rounded-lg border border-transparent bg-surface-container-high py-2 pl-10 pr-10 text-sm text-on-surface placeholder-on-surface-variant/45 outline-none transition-all duration-150 hover:bg-surface-container-highest focus:border-gold/40 focus:bg-surface-container-highest focus:ring-2 focus:ring-gold/15"
            />
            {hasQuery && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant/55 transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                aria-label="Clear search"
              >
                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 3l6 6M9 3L3 9" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="w-full sm:w-32">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            Item Level
          </label>
          <select
            value={ilvl ?? ''}
            onChange={(e) => setIlvl(e.target.value === '' ? null : Number(e.target.value))}
            className="h-10 w-full rounded-lg border border-transparent bg-surface-container-high px-3 text-sm tabular-nums text-on-surface outline-none transition-all duration-150 hover:bg-surface-container-highest focus:border-gold/40 focus:bg-surface-container-highest focus:ring-2 focus:ring-gold/15"
          >
            {seasonal.map((opt) => (
              <option key={opt.ilvl} value={opt.ilvl}>
                {opt.ilvl}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {hasQuery && results.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((item) => {
              const qualityColor = QUALITY_TEXT_CLASS[item.quality] ?? 'text-on-surface';
              const shownIlvl = effective?.ilvl ?? item.ilevel;
              const isAdding = adding === item.item_id;
              return (
                <button
                  key={item.item_id}
                  type="button"
                  disabled={isAdding}
                  onClick={() => handleAdd(item)}
                  className="group flex items-center gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-high/40 px-3 py-2 text-left transition-all duration-150 hover:border-gold/30 hover:bg-surface-container-high disabled:opacity-50"
                >
                  <div
                    className="h-9 w-9 shrink-0 overflow-hidden rounded-md border-b-2 bg-surface-container-highest"
                    style={{ borderBottomColor: qualityBorderColor(item.quality) }}
                  >
                    <img
                      src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] font-bold ${qualityColor}`}>{item.name}</p>
                    <p className="text-[11px] text-on-surface-variant/60">
                      <span className="tabular-nums">{shownIlvl}</span>{' '}
                      {SLOT_LABELS[item.inventory_type] ?? ''}
                    </p>
                  </div>
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant/50 transition-colors group-hover:bg-gold/15 group-hover:text-gold"
                    aria-hidden
                  >
                    {isAdding ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                        <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M8 3v10M3 8h10" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {capped && (
            <p className="text-center text-xs text-on-surface-variant/50">
              More items match this search than can be shown. Make your search more specific.
            </p>
          )}
        </>
      )}

      {hasQuery && results.length === 0 && (
        <p className="py-2 text-center text-sm text-on-surface-variant/50">No items found.</p>
      )}
    </div>
  );
}
