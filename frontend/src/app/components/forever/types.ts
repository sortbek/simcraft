export interface ForeverGear {
  slot: string;
  item_id: number;
  enchant_id: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  known: boolean;
}

export interface ForeverImport {
  game: 'forever';
  name: string;
  class: string;
  race: string;
  level: number;
  client_build: string | null;
  spec_key: string | null;
  spec_choices: string[];
  talents_string: string;
  points_per_tree: number[];
  equipped: ForeverGear[];
  bags: ForeverGear[];
  warnings: string[];
  can_sim: boolean;
  blocked_reason: string | null;
}
