import {
  type Dispatch,
  type SetStateAction,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { API_URL, apiUrl, fetchJsonOr } from './api';
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

// Module-level cache persists across renders/components.
const cache: Record<string, ItemInfo> = {};

function cacheKey(item_id: number, bonus_ids?: number[]): string {
  if (!bonus_ids || bonus_ids.length === 0) return String(item_id);
  return `${item_id}:${[...bonus_ids].sort((a, b) => a - b).join(':')}`;
}

/** @deprecated import `QUALITY_HEX` from `lib/qualityColors` instead. */
export const QUALITY_COLORS = QUALITY_HEX;

/**
 * Shared effect skeleton for the three batch-info hooks.
 * - `depKey` drives the effect dependency array.
 * - `prepare` runs inside the effect (so module-cache reads are fresh) and
 *   splits inputs into `{ cached, toFetch }`.
 * - `fetchMissing` POSTs `toFetch`, populates the module cache, and resolves
 *   the new entries; takes a `cancelled()` guard.
 * - `setState` is the hook's own dispatcher (generic so each keeps its Record type).
 */
function useBatchEffect<TItem, TFetch>(
  depKey: string,
  prepare: () => { cached: Record<number, TItem>; toFetch: TFetch[] },
  fetchMissing: (
    toFetch: TFetch[],
    signalCancelled: () => boolean
  ) => Promise<Record<number, TItem>>,
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
  fetchJsonOr<Record<string, Record<string, string>>>(apiUrl('/api/item-names'), {})
    .then((data) => {
      // JSON object keys are strings; rekey by number.
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

const ICON_BASE = 'https://render.worldofwarcraft.com/icons/56';
const FALLBACK_ICON = 'inv_misc_questionmark';

/** Icon name → FileDataID, for icons Blizzard's CDN refuses to serve by name.
 *  Blizzard addresses icons by FileDataID; the name path is a legacy alias that
 *  was never populated for newer art, so those names 403. The backend builds
 *  this map from `icon-file-ids.json` (see `backend/scripts/fetch_icon_file_ids.py`);
 *  it is empty until the fetch resolves and when that file hasn't been generated. */
let iconFileIds: Record<string, number> = {};
let iconFileIdsPromise: Promise<void> | undefined;

/** Load the FileDataID map once per session. A failed fetch degrades to an empty
 *  map, leaving every icon on its name — the pre-existing behaviour. */
function loadIconFileIds(): Promise<void> {
  if (!iconFileIdsPromise) {
    iconFileIdsPromise = fetchJsonOr<Record<string, number>>(apiUrl('/api/icon-file-ids'), {}).then(
      (map) => {
        iconFileIds = map;
      }
    );
  }
  return iconFileIdsPromise;
}

// Warm the map at import so the common case builds a working URL on first
// render. Browser-only: during SSR there is no API base to resolve against.
if (typeof window !== 'undefined') void loadIconFileIds();

function getIconUrl(iconName: string): string {
  const fileDataId = iconFileIds[iconName?.toLowerCase()];
  return `${ICON_BASE}/${fileDataId ?? iconName}.jpg`;
}

/** `onError` for icon images. Icons that raced the map load retry once via
 *  FileDataID, then settle on the questionmark rather than a broken-image glyph.
 *  Requires `data-icon={iconName}` on the element to know what to retry —
 *  `iconProps` wires that up for you.
 *
 *  Handles both `<img>` and SVG `<image>`, which carry their URL on different
 *  attributes (TalentTree renders icons inside an SVG). */
type IconEl = HTMLImageElement | SVGImageElement;

const iconSrc = (el: IconEl): string =>
  el instanceof SVGImageElement ? (el.getAttribute('href') ?? '') : el.src;

function setIconSrc(el: IconEl, url: string): void {
  if (el instanceof SVGImageElement) el.setAttribute('href', url);
  else el.src = url;
}

function onIconError(e: SyntheticEvent<IconEl>): void {
  const el = e.currentTarget;
  const iconName = el.dataset.icon?.toLowerCase() ?? '';
  const fallbackUrl = getIconUrl(FALLBACK_ICON);
  // Key the guard to the icon name, not the element: React reuses the same
  // <img> node when a gear slot's item changes, and a plain "already retried"
  // flag would cost every later icon in that slot its retry for the session.
  const stage = el.dataset.iconRetryFor === iconName ? el.dataset.iconRetryStage : undefined;
  if (stage === 'settled') return; // the questionmark itself failed — nothing left
  el.dataset.iconRetryFor = iconName;

  const settle = () => {
    el.dataset.iconRetryStage = 'fallback';
    setIconSrc(el, fallbackUrl);
  };
  if (stage === 'fallback') {
    // Either the questionmark we applied has now failed, or React re-rendered
    // this element back to a URL for the same icon that still fails (slot A → B
    // → A). Tell them apart by what is actually on the element, so the second
    // case still gets a questionmark instead of a broken-image glyph.
    if (iconSrc(el) === fallbackUrl) el.dataset.iconRetryStage = 'settled';
    else settle();
    return;
  }
  if (stage === 'retried') {
    settle(); // the FileDataID URL failed too
    return;
  }
  el.dataset.iconRetryStage = 'retried';
  void loadIconFileIds().then(() => {
    // The element may have been reused for a different icon while the map was
    // in flight; writing now would clobber an image that loaded perfectly well.
    if ((el.dataset.icon?.toLowerCase() ?? '') !== iconName) return;
    const mapped = iconName ? iconFileIds[iconName] : undefined;
    if (!mapped) {
      settle();
      return;
    }
    // The map may already have been applied at render time, in which case the
    // retry URL is the one that just failed; go straight to the questionmark.
    const next = getIconUrl(iconName);
    if (next === iconSrc(el)) settle();
    else setIconSrc(el, next);
  });
}

/** Everything an icon `<img>` needs: URL, the name the retry reads back, and the
 *  retry handler. Spread it — `<img {...iconProps(item.icon)} alt="" />` — so a
 *  new icon site can't half-adopt the mechanism and silently lose its retry. */
export function iconProps(iconName: string | undefined | null) {
  const name = iconName || FALLBACK_ICON;
  return { src: getIconUrl(name), 'data-icon': name, onError: onIconError };
}

/** `iconProps` for SVG `<image>`, which uses `href` rather than `src`. */
export function iconHrefProps(iconName: string | undefined | null) {
  const name = iconName || FALLBACK_ICON;
  return { href: getIconUrl(name), 'data-icon': name, onError: onIconError };
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

/** Normalize the two gem-id shapes (legacy `gem_id`, full `gem_ids` array) into one
 *  filtered list. Use whenever rendering or querying Wowhead with a slot's gems. */
export function toGemIdList(opts: { gem_id?: number; gem_ids?: number[] }): number[] {
  const raw = opts.gem_ids?.length ? opts.gem_ids : opts.gem_id ? [opts.gem_id] : [];
  return raw.filter((g) => g > 0);
}

export function getWowheadData(
  bonusIds?: number[],
  ilevel?: number,
  enchantId?: number,
  gemIds?: number[],
  // Rendered via a `crafted-stats=` param, not as bonus IDs.
  craftedStats?: number[]
): string {
  const parts: string[] = [];
  if (bonusIds && bonusIds.length > 0) {
    parts.push(`bonus=${bonusIds.join(':')}`);
  }
  if (craftedStats && craftedStats.length > 0) {
    parts.push(`crafted-stats=${craftedStats.join(':')}`);
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
