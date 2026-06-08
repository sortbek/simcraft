import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { API_URL } from './api';
import { QUALITY_HEX } from './qualityColors';

export interface ItemQuery {
  item_id: number;
  bonus_ids?: number[];
}

export interface ItemInfo {
  item_id: number;
  name: string;
  quality: number;
  quality_name: string;
  icon: string;
  ilevel: number;
  tag?: string;
  sockets?: number;
  upgrade?: string;
  armor_subclass?: number; // 0=Misc, 1=Cloth, 2=Leather, 3=Mail, 4=Plate
  inventory_type?: number; // 13=One-hand, 14=Shield, 17=Two-hand, 21=Main-hand, 22=Off-hand, 23=Held
}

// Module-level cache so it persists across renders/components
const cache: Record<string, ItemInfo> = {};

function cacheKey(item_id: number, bonus_ids?: number[]): string {
  if (!bonus_ids || bonus_ids.length === 0) return String(item_id);
  return `${item_id}:${[...bonus_ids].sort((a, b) => a - b).join(':')}`;
}

/** @deprecated import `QUALITY_HEX` from `lib/qualityColors` instead. */
export const QUALITY_COLORS = QUALITY_HEX;

/**
 * Shared effect skeleton for the three batch-info hooks.
 *
 * `depKey`      – stable string that drives the effect dependency array.
 * `prepare`     – splits inputs into already-cached and missing entries;
 *                 returns `{ cached, toFetch }`. Called inside the effect so
 *                 module-cache reads are always fresh.
 * `fetchMissing`– fires the POST and populates the module cache; receives the
 *                 `toFetch` list from `prepare` and a `cancelled()` guard;
 *                 resolves with the new entries to merge into state.
 * `setState`    – the hook's own `setState` dispatcher (typed generically so
 *                 each hook keeps its concrete Record type).
 */
function useBatchEffect<TItem, TFetch>(
  depKey: string,
  prepare: () => { cached: Record<number, TItem>; toFetch: TFetch[] },
  fetchMissing: (toFetch: TFetch[], signalCancelled: () => boolean) => Promise<Record<number, TItem>>,
  setState: Dispatch<SetStateAction<Record<number, TItem>>>
) {
  useEffect(() => {
    const { cached, toFetch } = prepare();

    if (Object.keys(cached).length > 0) {
      setState((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const batch = await fetchMissing(toFetch, () => cancelled);
        if (cancelled) return;
        if (Object.keys(batch).length > 0) setState((prev) => ({ ...prev, ...batch }));
      } catch {
        // Silently fail
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useItemInfo(queries: ItemQuery[]): Record<number, ItemInfo> {
  const [items, setItems] = useState<Record<number, ItemInfo>>({});

  const depKey = queries
    .filter((q) => q.item_id > 0)
    .map((q) => cacheKey(q.item_id, q.bonus_ids))
    .join(',');

  useBatchEffect<ItemInfo, ItemQuery>(
    depKey,
    () => {
      const unique = new Map<string, ItemQuery>();
      for (const q of queries) {
        if (q.item_id <= 0) continue;
        const key = cacheKey(q.item_id, q.bonus_ids);
        if (!unique.has(key)) unique.set(key, q);
      }

      const cached: Record<number, ItemInfo> = {};
      const toFetch: ItemQuery[] = [];
      for (const [key, q] of unique) {
        if (cache[key]) {
          cached[q.item_id] = cache[key];
        } else {
          toFetch.push(q);
        }
      }
      return { cached, toFetch };
    },
    async (toFetch, signalCancelled) => {
      const body = {
        items: toFetch.map((q) => ({ item_id: q.item_id, bonus_ids: q.bonus_ids ?? [] })),
      };
      const res = await fetch(`${API_URL}/api/item-info/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok || signalCancelled()) return {};
      const data: Record<string, ItemInfo> = await res.json();
      if (signalCancelled()) return {};
      const batch: Record<number, ItemInfo> = {};
      for (const q of toFetch) {
        const info = data[String(q.item_id)];
        if (!info) continue;
        const key = cacheKey(q.item_id, q.bonus_ids);
        cache[key] = info;
        batch[q.item_id] = info;
      }
      return batch;
    },
    setItems
  );

  return items;
}

export interface EnchantInfo {
  enchant_id: number;
  name: string;
  item_id?: number;
}

const enchantCache: Record<number, EnchantInfo> = {};

export function useEnchantInfo(enchantIds: number[]): Record<number, EnchantInfo> {
  const [enchants, setEnchants] = useState<Record<number, EnchantInfo>>({});

  const depKey = enchantIds
    .filter((id) => id > 0)
    .sort()
    .join(',');

  useBatchEffect<EnchantInfo, number>(
    depKey,
    () => {
      const unique = new Set(enchantIds.filter((id) => id > 0));
      const cached: Record<number, EnchantInfo> = {};
      const toFetch: number[] = [];
      for (const id of unique) {
        if (enchantCache[id]) {
          cached[id] = enchantCache[id];
        } else {
          toFetch.push(id);
        }
      }
      return { cached, toFetch };
    },
    async (toFetch, signalCancelled) => {
      const res = await fetch(`${API_URL}/api/enchant-info/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toFetch }),
      });
      if (!res.ok || signalCancelled()) return {};
      const data: { enchants: EnchantInfo[] } = await res.json();
      if (signalCancelled()) return {};
      const batch: Record<number, EnchantInfo> = {};
      for (const info of data.enchants) {
        if (!info.name) continue;
        enchantCache[info.enchant_id] = info;
        batch[info.enchant_id] = info;
      }
      return batch;
    },
    setEnchants
  );

  return enchants;
}

export interface GemInfo {
  gem_id: number;
  name: string;
  icon: string;
  quality: number;
}

const gemCache: Record<number, GemInfo> = {};

export function useGemInfo(gemIds: number[]): Record<number, GemInfo> {
  const [gems, setGems] = useState<Record<number, GemInfo>>({});

  const depKey = gemIds
    .filter((id) => id > 0)
    .sort()
    .join(',');

  useBatchEffect<GemInfo, number>(
    depKey,
    () => {
      const unique = new Set(gemIds.filter((id) => id > 0));
      const cached: Record<number, GemInfo> = {};
      const toFetch: number[] = [];
      for (const id of unique) {
        if (gemCache[id]) {
          cached[id] = gemCache[id];
        } else {
          toFetch.push(id);
        }
      }
      return { cached, toFetch };
    },
    async (toFetch, signalCancelled) => {
      const res = await fetch(`${API_URL}/api/gem-info/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toFetch }),
      });
      if (!res.ok || signalCancelled()) return {};
      const data: { gems: GemInfo[] } = await res.json();
      if (signalCancelled()) return {};
      const batch: Record<number, GemInfo> = {};
      for (const info of data.gems) {
        if (!info.name) continue;
        gemCache[info.gem_id] = info;
        batch[info.gem_id] = info;
      }
      return batch;
    },
    setGems
  );

  return gems;
}

// ---- Localized item names (fetched once from /api/item-names) ----

let itemNamesMap: Record<number, Record<string, string>> | null = null;
let itemNamesFetching = false;
const itemNamesListeners: Array<() => void> = [];

function ensureItemNames() {
  if (itemNamesMap || itemNamesFetching) return;
  itemNamesFetching = true;
  fetch(`${API_URL}/api/item-names`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((data: Record<string, Record<string, string>>) => {
      // Convert string keys to number keys
      const map: Record<number, Record<string, string>> = {};
      for (const [id, locales] of Object.entries(data)) {
        map[Number(id)] = locales;
      }
      itemNamesMap = map;
      for (const cb of itemNamesListeners) cb();
      itemNamesListeners.length = 0;
    })
    .catch(() => {
      itemNamesMap = {};
    })
    .finally(() => {
      itemNamesFetching = false;
    });
}

/** Get item name in the given locale, falling back to the English name. */
export function localizedItemName(itemId: number, fallbackName: string, locale: string): string {
  if (!locale || locale === 'en_US') return fallbackName;
  return itemNamesMap?.[itemId]?.[locale] ?? fallbackName;
}

/** Hook that triggers a fetch of item names and re-renders when ready. */
export function useItemNames() {
  const [, setReady] = useState(!!itemNamesMap);
  const cbRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (itemNamesMap) return;
    const cb = () => setReady(true);
    cbRef.current = cb;
    itemNamesListeners.push(cb);
    ensureItemNames();
    return () => {
      const idx = itemNamesListeners.indexOf(cb);
      if (idx >= 0) itemNamesListeners.splice(idx, 1);
    };
  }, []);
}

/** Translate an upgrade string like "Champion 2/6" using the t() function for the track name. */
export function localizedUpgrade(upgrade: string, t: (key: string) => string): string {
  if (!upgrade) return upgrade;
  const match = upgrade.match(/^(\w+)(\s.*)$/);
  if (!match) return upgrade;
  const translated = t(`track.${match[1]}`);
  // If the key wasn't found (returned as-is), keep original
  if (translated === `track.${match[1]}`) return upgrade;
  return translated + match[2];
}

/** Get enchant name in the given locale using the item-names lookup. */
export function localizedEnchantName(enchant: EnchantInfo, locale: string): string {
  if (!locale || locale === 'en_US' || !enchant.item_id) return enchant.name;
  return itemNamesMap?.[enchant.item_id]?.[locale] ?? enchant.name;
}

/** Get gem name in the given locale using the item-names lookup. */
export function localizedGemName(gem: GemInfo, locale: string): string {
  if (!locale || locale === 'en_US') return gem.name;
  return itemNamesMap?.[gem.gem_id]?.[locale] ?? gem.name;
}

export function getIconUrl(iconName: string): string {
  return `https://render.worldofwarcraft.com/icons/56/${iconName}.jpg`;
}

const WOWHEAD_DOMAINS: Record<string, string> = {
  en_US: 'www.wowhead.com',
  de_DE: 'de.wowhead.com',
  es_ES: 'es.wowhead.com',
  fr_FR: 'fr.wowhead.com',
  it_IT: 'it.wowhead.com',
  pt_BR: 'pt.wowhead.com',
  ru_RU: 'ru.wowhead.com',
};

export function getWowheadUrl(itemId: number, locale?: string): string {
  const domain = (locale && WOWHEAD_DOMAINS[locale]) || 'www.wowhead.com';
  return `https://${domain}/item=${itemId}`;
}

/**
 * Normalize the two gem-id shapes (single `gem_id` legacy field, full
 * `gem_ids` array) into a single filtered list. Use this whenever you
 * need to render or query Wowhead with the gems on a slot.
 */
export function toGemIdList(opts: { gem_id?: number; gem_ids?: number[] }): number[] {
  const raw = opts.gem_ids?.length ? opts.gem_ids : opts.gem_id ? [opts.gem_id] : [];
  return raw.filter((g) => g > 0);
}

export function getWowheadData(
  bonusIds?: number[],
  ilevel?: number,
  enchantId?: number,
  gemIds?: number[]
): string {
  const parts: string[] = [];
  if (bonusIds && bonusIds.length > 0) {
    parts.push(`bonus=${bonusIds.join(':')}`);
  }
  if (ilevel && ilevel > 0) {
    parts.push(`ilvl=${ilevel}`);
  }
  if (enchantId && enchantId > 0) {
    parts.push(`ench=${enchantId}`);
  }
  if (gemIds && gemIds.length > 0) {
    parts.push(`gems=${gemIds.join(':')}`);
  }
  return parts.join('&');
}
