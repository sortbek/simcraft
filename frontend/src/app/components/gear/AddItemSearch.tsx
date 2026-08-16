'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl, fetchJson, postJson } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { QUALITY_TEXT_CLASS, qualityBorderColor } from '../../lib/qualityColors';
import { getIconUrl, onIconError } from '../../lib/useItemInfo';
import Checkbox from '../ui/Checkbox';
import { detectClass, detectSpec } from '../loot/types';
import type { ResolvedItem } from '../../lib/types';

interface IlvlOption {
  ilvl: number;
  bonus_id: number;
}

interface SearchItem {
  item_id: number;
  name: string;
  icon: string;
  inventory_type: number;
  quality: number;
  ilevel: number;
  /** Item levels this specific item can exist at, highest first. */
  ilvl_options: IlvlOption[];
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

export default function AddItemSearch({ simcInput, onItemsResolved }: AddItemSearchProps) {
  const { locale } = useLanguage();
  const className = useMemo(() => detectClass(simcInput), [simcInput]);
  const spec = useMemo(() => detectSpec(simcInput), [simcInput]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  // Chosen item level per item_id; unset items use their highest available level.
  const [chosenIlvl, setChosenIlvl] = useState<Record<number, number>>({});
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seasonalOnly, setSeasonalOnly] = useState(true);

  // Debounced search; an AbortController drops stale responses.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    // Search the current-season drop catalog filtered to this class/spec (the
    // same data DropFinder uses), so only obtainable items appear.
    const classParam = className ? `&class_name=${className}` : '';
    const specParam = spec ? `&spec=${spec}` : '';
    const timer = setTimeout(() => {
      fetchJson<{ items: SearchItem[] }>(
        apiUrl(
          `/api/items/search?q=${encodeURIComponent(q)}&locale=${locale}${classParam}${specParam}&seasonal=${seasonalOnly}`
        ),
        { signal: controller.signal }
      )
        .then((data) => {
          setResults(data.items ?? []);
          setError(null);
        })
        .catch((e: unknown) => {
          // Aborts are expected on debounce/unmount — keep the prior results.
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setResults([]);
          setError(e instanceof Error ? e.message : 'Search failed');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, locale, className, spec, seasonalOnly]);

  const handleAdd = useCallback(
    async (item: SearchItem, option: IlvlOption | undefined) => {
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
    [simcInput, onItemsResolved]
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
          Search items your class can use and add them at a chosen item level. Lets you sim gear you
          don&apos;t own yet.
        </p>
      </div>

      <div>
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
              <svg
                viewBox="0 0 12 12"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M3 3l6 6M9 3L3 9" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
        <Checkbox
          variant="primary"
          size="sm"
          checked={seasonalOnly}
          onChange={() => setSeasonalOnly((v) => !v)}
          aria-label="Seasonal items only"
        />
        Seasonal items only
        <span className="text-xs text-on-surface-variant/50">(off: search every expansion)</span>
      </label>

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
              const options = item.ilvl_options ?? [];
              // Resolve the option FIRST, then read the level off it: a remembered
              // choice can be absent from a later result set (toggling "Seasonal
              // items only" re-narrows the list), and a `value` with no matching
              // <option> renders blank while Add silently submits options[0].
              const option = options.find((o) => o.ilvl === chosenIlvl[item.item_id]) ?? options[0];
              const selected = option?.ilvl;
              const isAdding = adding === item.item_id;
              return (
                <div
                  key={item.item_id}
                  className="group flex items-center gap-2 rounded-xl border border-outline-variant/10 bg-surface-container-high/40 px-3 py-2 transition-all duration-150 hover:border-gold/30 hover:bg-surface-container-high"
                >
                  <div
                    className="h-9 w-9 shrink-0 overflow-hidden rounded-md border-b-2 bg-surface-container-highest"
                    style={{ borderBottomColor: qualityBorderColor(item.quality) }}
                  >
                    <img
                      src={getIconUrl(item.icon)}
                      data-icon={item.icon}
                      onError={onIconError}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] font-bold ${qualityColor}`}>{item.name}</p>
                    <p className="text-[11px] text-on-surface-variant/60">
                      {SLOT_LABELS[item.inventory_type] ?? ''}
                    </p>
                  </div>
                  {/* Only the levels this item can actually exist at. */}
                  <select
                    value={selected ?? ''}
                    onChange={(e) =>
                      setChosenIlvl((prev) => ({ ...prev, [item.item_id]: Number(e.target.value) }))
                    }
                    aria-label={`Item level for ${item.name}`}
                    className="h-7 shrink-0 rounded-md border border-transparent bg-surface-container-highest px-1 text-xs font-bold tabular-nums text-on-surface outline-none transition-all duration-150 hover:border-gold/30 focus:border-gold/40 focus:ring-2 focus:ring-gold/15"
                  >
                    {options.map((opt) => (
                      <option key={opt.ilvl} value={opt.ilvl}>
                        {opt.ilvl}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={() => handleAdd(item, option)}
                    aria-label={`Add ${item.name}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant/50 transition-colors hover:bg-gold/25 hover:text-gold disabled:opacity-50 group-hover:bg-gold/15 group-hover:text-gold"
                  >
                    {isAdding ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                        <circle
                          cx="8"
                          cy="8"
                          r="6"
                          stroke="currentColor"
                          strokeWidth="2"
                          opacity="0.25"
                        />
                        <path
                          d="M14 8a6 6 0 00-6-6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M8 3v10M3 8h10" />
                      </svg>
                    )}
                  </button>
                </div>
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
