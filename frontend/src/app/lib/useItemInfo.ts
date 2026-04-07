import { useEffect, useRef, useState } from 'react';
import { API_URL } from './api';

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

export const QUALITY_COLORS: Record<number, string> = {
  0: '#9d9d9d', // Poor
  1: '#ffffff', // Common
  2: '#1eff00', // Uncommon
  3: '#0070dd', // Rare
  4: '#a335ee', // Epic
  5: '#ff8000', // Legendary
  6: '#e6cc80', // Artifact
  7: '#00ccff', // Heirloom
};

export function useItemInfo(queries: ItemQuery[]): Record<number, ItemInfo> {
  const [items, setItems] = useState<Record<number, ItemInfo>>({});

  // Stable dependency key
  const depKey = queries
    .filter((q) => q.item_id > 0)
    .map((q) => cacheKey(q.item_id, q.bonus_ids))
    .join(',');

  useEffect(() => {
    const unique = new Map<string, ItemQuery>();
    for (const q of queries) {
      if (q.item_id <= 0) continue;
      const key = cacheKey(q.item_id, q.bonus_ids);
      if (!unique.has(key)) unique.set(key, q);
    }
    if (unique.size === 0) return;

    // Return cached immediately
    const cached: Record<number, ItemInfo> = {};
    const toFetch: ItemQuery[] = [];
    for (const [key, q] of unique) {
      if (cache[key]) {
        cached[q.item_id] = cache[key];
      } else {
        toFetch.push(q);
      }
    }

    if (Object.keys(cached).length > 0) {
      setItems((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    // Fetch each item individually so results appear as they arrive
    for (const q of toFetch) {
      (async () => {
        try {
          const params = new URLSearchParams();
          if (q.bonus_ids && q.bonus_ids.length > 0) {
            params.set('bonus_ids', q.bonus_ids.join(','));
          }
          const url = `${API_URL}/api/item-info/${q.item_id}?${params}`;
          const res = await fetch(url);
          if (!res.ok || cancelled) return;
          const info: ItemInfo = await res.json();
          if (cancelled) return;

          const key = cacheKey(q.item_id, q.bonus_ids);
          cache[key] = info;
          setItems((prev) => ({ ...prev, [q.item_id]: info }));
        } catch {
          // Silently fail
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    const unique = new Set(enchantIds.filter((id) => id > 0));
    if (unique.size === 0) return;

    const cached: Record<number, EnchantInfo> = {};
    const toFetch: number[] = [];
    for (const id of unique) {
      if (enchantCache[id]) {
        cached[id] = enchantCache[id];
      } else {
        toFetch.push(id);
      }
    }

    if (Object.keys(cached).length > 0) {
      setEnchants((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    for (const id of toFetch) {
      (async () => {
        try {
          const res = await fetch(`${API_URL}/api/enchant-info/${id}`);
          if (!res.ok || cancelled) return;
          const info: EnchantInfo = await res.json();
          if (cancelled || !info.name) return;
          enchantCache[id] = info;
          setEnchants((prev) => ({ ...prev, [id]: info }));
        } catch {
          // Silently fail
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    const unique = new Set(gemIds.filter((id) => id > 0));
    if (unique.size === 0) return;

    const cached: Record<number, GemInfo> = {};
    const toFetch: number[] = [];
    for (const id of unique) {
      if (gemCache[id]) {
        cached[id] = gemCache[id];
      } else {
        toFetch.push(id);
      }
    }

    if (Object.keys(cached).length > 0) {
      setGems((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    for (const id of toFetch) {
      (async () => {
        try {
          const res = await fetch(`${API_URL}/api/gem-info/${id}`);
          if (!res.ok || cancelled) return;
          const info: GemInfo = await res.json();
          if (cancelled || !info.name) return;
          gemCache[id] = info;
          setGems((prev) => ({ ...prev, [id]: info }));
        } catch {
          // Silently fail
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

export function getWowheadData(
  bonusIds?: number[],
  ilevel?: number,
  enchantId?: number,
  gemId?: number
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
  if (gemId && gemId > 0) {
    parts.push(`gems=${gemId}`);
  }
  return parts.join('&');
}
