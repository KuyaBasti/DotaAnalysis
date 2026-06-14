// TypeScript shapes for the patch snapshot the API serves.
//
// TODO: these are hand-maintained for now. Per schemas/ being the single source
// of truth, they should eventually be generated from snapshot.schema.json via a
// codegen step (see web/ + api/ types/generated dirs) rather than kept in sync
// by hand.

export interface AttrTriple {
  str: number;
  agi: number;
  int: number;
}

export interface Hero {
  key: string;
  display_name: string;
  primary_attr: "str" | "agi" | "int" | "all";
  attack_type: "melee" | "ranged";
  roles: string[];
  base_stats: AttrTriple;
  stat_gain: AttrTriple;
  attack: { min: number; max: number };
  move_speed: number;
}

export interface Item {
  key: string;
  display_name: string;
  cost: number | null;
  cooldown: number | null;
  mana_cost: number | null;
  components: string[] | null;
}

export interface PatchSnapshot {
  patch_id: string;
  source?: string;
  generated_at?: string;
  heroes: Hero[];
  items?: Item[];
}
