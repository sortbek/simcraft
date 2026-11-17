export interface ForeverGear {
  slot: string;
  item_id: number;
  enchant_id: number;
  random_suffix: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  known: boolean;
}

export interface ForeverTalent {
  name: string;
  spell_id: number;
  icon: string;
  row: number;
  col: number;
  max_ranks: number;
  /** [row, col] of the talent this one needs. */
  prereq?: [number, number];
  rank: number;
}

export interface ForeverTalentTree {
  name: string;
  points: number;
  talents: ForeverTalent[];
}

export interface ForeverImport {
  game: 'forever';
  name: string;
  /** Battle.net region; empty when the export names none. */
  region: string;
  class: string;
  race: string;
  level: number;
  has_sheet: boolean;
  client_build: string | null;
  spec_key: string | null;
  spec_choices: string[];
  talents_string: string;
  exported_talents_string: string;
  max_talent_points: number;
  points_per_tree: number[];
  /** Empty with an engine bundle built before the calculator layout. */
  talent_trees: ForeverTalentTree[];
  equipped: ForeverGear[];
  bags: ForeverGear[];
  warnings: string[];
  can_sim: boolean;
  blocked_reason: string | null;
  /** Per spec key; empty with an engine that lists no options. */
  sim_options?: Record<string, ForeverSimOptions>;
}

export interface ForeverToggle {
  id: string;
  group: 'buff' | 'debuff';
  label: string;
  /** The build's starting state. */
  on: boolean;
}

export interface ForeverSimOptions {
  build: string;
  toggles: ForeverToggle[];
  consumables: boolean;
}

/** One source in the Drop Finder (an instance, quest zone, vendor, faction, ...), for a character. */
export interface ForeverDropSource {
  key: string;
  category: 'dungeon' | 'raid' | 'quest' | 'reputation' | 'crafted' | 'vendor' | 'pvp' | 'world';
  name: string;
  zone: string;
  /** An instance's entry level; 0 for other sources. */
  level: number;
  /** Added in Forever. */
  new: boolean;
  /** Gear this source has for anyone. */
  total: number;
  /** Gear from here the character can wear. */
  count: number;
  min_level: number | null;
  max_level: number | null;
  /** Lowest and highest reputation standing its items need. */
  standings: [string, string] | null;
}

export interface ForeverDropSources {
  /** False with an engine built before item sources. */
  available: boolean;
  groups: ForeverDropSource[];
}
