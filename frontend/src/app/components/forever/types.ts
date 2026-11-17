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
