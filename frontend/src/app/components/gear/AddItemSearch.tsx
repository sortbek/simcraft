'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, fetchJson, postJson } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { QUALITY_TEXT_CLASS } from '../../lib/qualityColors';
import type { UpgradeTracks } from '../loot/types';
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

/** Distinct item levels achievable this season (every upgrade-track level),
 *  highest first, each mapped to its track bonus id. The item's own base ilvl is
 *  included (bonus 0) when the tracks don't already cover it. */
function buildSeasonIlvlOptions(tracks: UpgradeTracks, baseIlvl: number): IlvlOption[] {
  const byIlvl = new Map<number, IlvlOption>();
  for (const levels of Object.values(tracks)) {
    for (const lvl of levels) {
      if (!byIlvl.has(lvl.ilvl)) byIlvl.set(lvl.ilvl, { ilvl: lvl.ilvl, bonus_id: lvl.bonus_id });
    }
  }
  if (baseIlvl > 0 && !byIlvl.has(baseIlvl)) byIlvl.set(baseIlvl, { ilvl: baseIlvl, bonus_id: 0 });
  return [...byIlvl.values()].sort((a, b) => b.ilvl - a.ilvl);
}

export default function AddItemSearch({ simcInput, onItemsResolved }: AddItemSearchProps) {
  const { locale } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [tracks, setTracks] = useState<UpgradeTracks>({});
  const [ilvlByItem, setIlvlByItem] = useState<Record<number, number>>({});
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<UpgradeTracks>(apiUrl('/api/upgrade-tracks'))
      .then(setTracks)
      .catch(() => {});
  }, []);

  // Debounced search; an AbortController drops stale responses.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchJson<{ items: SearchItem[] }>(
        apiUrl(`/api/items/search?q=${encodeURIComponent(q)}&locale=${locale}`),
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
  }, [query, locale]);

  const optionsFor = useCallback(
    (item: SearchItem) => buildSeasonIlvlOptions(tracks, item.ilevel),
    [tracks]
  );

  const handleAdd = useCallback(
    async (item: SearchItem) => {
      const options = buildSeasonIlvlOptions(tracks, item.ilevel);
      const chosenIlvl = ilvlByItem[item.item_id] ?? options[0]?.ilvl ?? item.ilevel;
      const option = options.find((o) => o.ilvl === chosenIlvl) ?? options[0];
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
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add item');
      } finally {
        setAdding(null);
      }
    },
    [tracks, ilvlByItem, simcInput, onItemsResolved]
  );

  const hasQuery = query.trim().length > 0;

  return (
    <div className="relative">
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
          placeholder="Add an item — search by name"
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

      {error && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {hasQuery && results.length > 0 && (
        <div className="absolute z-30 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-outline-variant/15 bg-surface-container shadow-2xl">
          {results.map((item) => {
            const options = optionsFor(item);
            const selectedIlvl = ilvlByItem[item.item_id] ?? options[0]?.ilvl;
            const qualityColor = QUALITY_TEXT_CLASS[item.quality] ?? 'text-on-surface';
            return (
              <div
                key={item.item_id}
                className="flex items-center gap-3 border-b border-outline-variant/5 px-3 py-2 last:border-b-0 hover:bg-surface-container-high/40"
              >
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-surface-container-highest">
                  <img
                    src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className={`min-w-0 flex-1 truncate text-sm font-medium ${qualityColor}`}>
                  {item.name}
                </span>
                <select
                  value={selectedIlvl}
                  onChange={(e) =>
                    setIlvlByItem((prev) => ({ ...prev, [item.item_id]: Number(e.target.value) }))
                  }
                  className="rounded border border-outline-variant/30 bg-surface-container px-1.5 py-1 text-xs text-on-surface focus:outline-none"
                  aria-label="Item level"
                >
                  {options.map((opt) => (
                    <option key={opt.ilvl} value={opt.ilvl}>
                      {opt.ilvl}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={adding === item.item_id}
                  onClick={() => handleAdd(item)}
                  className="rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-90"
                >
                  {adding === item.item_id ? '...' : 'Add'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {hasQuery && results.length === 0 && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-outline-variant/15 bg-surface-container px-4 py-3 text-sm text-on-surface-variant/60 shadow-2xl">
          No items found.
        </div>
      )}
    </div>
  );
}
