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

export interface SimAggregate {
  scenario: { patch_id: string; radiant: string[]; dire: string[] };
  runs: number;
  radiant_win_rate: number;
  duration_seconds: { mean: number; p25: number; median: number; p75: number };
  duration_histogram: { minute: number; count: number }[];
  representative_sim_id: string;
  bracket?: string;
}

export interface SimsResponse {
  sims: string[];
}

// --- Draft evaluation (win-prob model, no full sim) -------------------------

export interface DraftEvalResponse {
  patch_id: string;
  bracket?: string;
  radiant_win_probability: number;
}
