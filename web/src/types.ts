// Mirrors the API's patch-data responses. Like the API's own types, these are
// hand-written for now and should eventually be generated from schemas/.

export interface Hero {
  key: string;
  display_name: string;
  primary_attr: "str" | "agi" | "int" | "all";
  attack_type: "melee" | "ranged";
  roles: string[];
}

export interface PatchesResponse {
  patches: string[];
}

export interface HeroesResponse {
  patch_id: string;
  heroes: Hero[];
}

// --- Simulation results (served at /sims) -----------------------------------

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

export interface SimsResponse {
  sims: string[];
}
