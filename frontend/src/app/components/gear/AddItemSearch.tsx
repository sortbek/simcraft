'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readStoredJson } from '../../lib/storage';
import { apiUrl, fetchJson, postJson } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { qualityBorderColor, qualityHex } from '../../lib/qualityColors';
import { iconProps } from '../../lib/useItemInfo';
import CardHeader from '../ui/CardHeader';
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

const OPEN_STORAGE_KEY = 'simhammer_topgear_additem_open';

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
  const [lootSpecOnly, setLootSpecOnly] = useState(true);
  const [open, setOpen] = useState(false);

  // Restored after mount to avoid an SSR hydration mismatch, like the page's
  // other collapsibles.
  useEffect(() => {
    setOpen(readStoredJson<boolean>(OPEN_STORAGE_KEY, false));
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

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
          `/api/items/search?q=${encodeURIComponent(q)}&locale=${locale}${classParam}${specParam}&seasonal=${seasonalOnly}&loot_spec=${lootSpecOnly}`
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
  }, [query, locale, className, spec, seasonalOnly, lootSpecOnly]);

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
    <div className="card">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="group block w-full text-left"
      >
        <CardHeader
          className={open ? '' : '!border-transparent'}
          title={
            <span className="flex items-center gap-2.5 transition-colors group-hover:text-on-surface">
              <svg
                className="h-3.5 w-3.5 shrink-0 text-gold"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
              Add item
            </span>
          }
          right={
            <span className="flex min-w-0 items-center gap-3">
              <span className="min-w-0 truncate text-[12.5px] text-outline">
                Search items your class can use and sim gear you don&apos;t own yet.
              </span>
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-outline transition-transform duration-200 group-hover:text-on-surface-variant ${
                  open ? 'rotate-180' : ''
                }`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </span>
          }
        />
      </button>

      {error && (
        <p className="mx-6 mt-4 rounded-[6px] border border-negative/25 bg-negative/[0.08] px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}

      {open && (
        <div className="space-y-4 px-6 py-[22px]">
          <div>
            <label className="label-text">Name</label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline"
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
                className="input-field h-[38px] py-0 pl-10 pr-10"
              />
              {hasQuery && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[5px] text-outline transition-colors hover:bg-surface-container-highest hover:text-on-surface"
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

          <div className="space-y-2">
            <label className="group flex w-fit cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
              <Checkbox
                size="sm"
                checked={seasonalOnly}
                onChange={() => setSeasonalOnly((v) => !v)}
                aria-label="Seasonal items only"
              />
              Seasonal items only
              <span className="text-xs text-outline">(off: search every expansion)</span>
            </label>

            {/* The all-expansions search does no spec filtering, so this would be a
            dead control there. */}
            {seasonalOnly && (
              <label className="group flex w-fit cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
                <Checkbox
                  size="sm"
                  checked={lootSpecOnly}
                  onChange={() => setLootSpecOnly((v) => !v)}
                  aria-label="My loot spec only"
                />
                My loot spec only
                <span className="text-xs text-outline">(off: any gear your class can equip)</span>
              </label>
            )}
          </div>

          {hasQuery && results.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((item) => {
                  const qualityColor = qualityHex(item.quality);
                  const options = item.ilvl_options ?? [];
                  // Resolve the option FIRST, then read the level off it: a remembered
                  // choice can be absent from a later result set (toggling "Seasonal
                  // items only" re-narrows the list), and a `value` with no matching
                  // <option> renders blank while Add silently submits options[0].
                  const option =
                    options.find((o) => o.ilvl === chosenIlvl[item.item_id]) ?? options[0];
                  const selected = option?.ilvl;
                  const isAdding = adding === item.item_id;
                  return (
                    <div
                      key={item.item_id}
                      className="group flex items-center gap-3 rounded-[7px] px-2.5 py-[7px] transition-colors duration-[120ms] hover:bg-surface-container-high"
                    >
                      <div
                        className="relative h-[38px] w-[38px] shrink-0 overflow-hidden rounded-[5px] border bg-surface-container-highest"
                        style={{ borderColor: qualityBorderColor(item.quality) }}
                      >
                        <img
                          {...iconProps(item.icon)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-semibold leading-tight"
                          style={{ color: qualityColor }}
                        >
                          {item.name}
                        </p>
                        <p className="mt-px text-xs text-outline">
                          {SLOT_LABELS[item.inventory_type] ?? ''}
                        </p>
                      </div>
                      {/* Only the levels this item can actually exist at. */}
                      <select
                        value={selected ?? ''}
                        onChange={(e) =>
                          setChosenIlvl((prev) => ({
                            ...prev,
                            [item.item_id]: Number(e.target.value),
                          }))
                        }
                        aria-label={`Item level for ${item.name}`}
                        className="h-7 shrink-0 rounded-[5px] border border-line/[0.06] bg-surface-container-highest px-1 font-headline text-xs font-bold tabular-nums text-on-surface outline-none transition-colors hover:border-line/[0.11] focus:ring-1 focus:ring-primary/30"
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
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-line/[0.06] bg-surface-container-highest text-outline transition-colors hover:bg-gold/20 hover:text-gold disabled:opacity-40 group-hover:border-gold/35 group-hover:bg-gold/10 group-hover:text-gold"
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
                <p className="text-center text-xs text-outline">
                  More items match this search than can be shown. Make your search more specific.
                </p>
              )}
            </>
          )}

          {hasQuery && results.length === 0 && (
            <p className="py-2 text-center text-sm text-outline">No items found.</p>
          )}
        </div>
      )}
    </div>
  );
}
