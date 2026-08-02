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

/** One hero's share of the credit or blame for a draft's win probability. */
export interface HeroContribution {
  /** Hero key, e.g. "sniper". */
  hero: string;
  hero_id: number;
  team: "radiant" | "dire";
  /**
   * Percentage points this hero adds to their own team's win probability,
   * versus an average hero in the same slot. Leave-one-out counterfactuals, so
   * they do not sum to the total.
   */
  swing: number;
}

export interface DraftExplanation {
  patch_id: string;
  bracket?: string;
  radiant_win_probability: number;
  /** Sorted by absolute swing, biggest mover first. */
  contributions: HeroContribution[];
}
