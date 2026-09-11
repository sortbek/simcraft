export { specDisplayName as formatSpecName } from '../../lib/types';
import { QUALITY_TEXT_CLASS } from '../../lib/qualityColors';

export interface Instance {
  id: number;
  name: string;
  type: string;
  order?: number;
  image_url?: string;
  encounters: { id: number; name: string; image_url?: string }[];
}

export interface TrackInfo {
  ilvl: number;
  bonus_id: number;
  quality: number;
  track?: string;
  level?: number;
  max_level?: number;
}

export interface TrackLevel {
  level: number;
  max_level: number;
  ilvl: number;
  bonus_id: number;
  quality: number;
}

export type UpgradeTracks = Record<string, TrackLevel[]>;

export interface DropItem {
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  encounter: string;
  instance_name?: string;
  instance_id?: number;
  inventory_type?: number;
  bonus_ids?: number[];
  difficulty_info?: Record<string, TrackInfo>;
  dungeon_info?: Record<string, TrackInfo>;
  specs?: number[];
  off_spec?: boolean;
  embellished?: boolean;
  /** Server eligibility shared with simulation generation. */
  accepts_preferred_stats?: boolean;
  is_void_forge?: boolean;
  is_catalyst?: boolean;
  source_item_id?: number;
  extra_bonus_ids?: number[];
  /** The item's own effect grants (e.g. procs); absent when it has none. */
  effect_bonus_ids?: number[];
  /** Per-item embellishment pick (canonical reagent id); absent = None. */
  embellishment_id?: number;
}

/**
 * Droptimizer request payload shape: `DropItem` plus resolved upgrade fields. Inheritance
 * (enchant/gem) is omitted — the backend derives it from the equipped profile, so the browser
 * doesn't compute simulation semantics.
 */
export interface DropItemPayload extends DropItem {
  ilevel: number;
  quality: number;
  bonus_ids: number[];
}

/** @deprecated import `QUALITY_TEXT_CLASS` from `lib/qualityColors`. */
export const QUALITY_COLORS = QUALITY_TEXT_CLASS;

export { dropUid, getTrackInfo, resolveUpgrade, detectClass, detectSpec } from './dropUtils';
