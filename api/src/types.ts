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
  id: number;
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

// --- Simulation results (written by the prototype sim, served at /sims) ------

export interface TimelineEvent {
  t: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface SimSummary {
  winner: string;
  duration_seconds: number;
  radiant_net_worth: number;
  dire_net_worth: number;
}

export interface SimResult {
  id: string;
  patch_id: string;
  seed: number;
  radiant: string[];
  dire: string[];
  summary: SimSummary;
  timeline: TimelineEvent[];
}

// --- Draft evaluation (win-prob model, no full sim) --------------------------

export interface DraftEvalRequest {
  radiant: string[]; // hero keys
  dire: string[];
  patch_id?: string;
}

export interface DraftEvalResponse {
  patch_id: string;
  radiant_win_probability: number;
}
