// GENERATED from schemas/*.schema.json — do not edit by hand.
// Regenerate with `npm run generate:types`; a freshness test fails when this
// file and the schemas disagree.
/* eslint-disable */

/**
 * One simulated match: the scenario that produced it, a summary, and the full event timeline. This is the shape the sim CLI exports to data/sims/sim.<id>.json and the API serves at GET /sims/:id.
 */
export interface SimResult {
  /**
   * Stable id, formatted "<patch_id>-seed<seed>", e.g. "7.41d-seed42".
   */
  id: string;
  patch_id: string;
  /**
   * RNG seed; same scenario + seed reproduce this timeline exactly.
   */
  seed: number;
  radiant: string[];
  dire: string[];
  summary: SimSummary;
  /**
   * Every event, in non-decreasing t order.
   */
  timeline: TimelineEvent[];
}
export interface SimSummary {
  winner: "radiant" | "dire";
  duration_seconds: number;
  radiant_net_worth: number;
  dire_net_worth: number;
  /**
   * Enemy structures Radiant destroyed (5 = the Dire Ancient fell).
   */
  radiant_objectives: number;
  dire_objectives: number;
}
/**
 * One event in a simulated match timeline. The envelope is stable (t, type, payload); the payload shape depends on type. See docs/02-data-model.md for per-type payload fields. Events are emitted in non-decreasing t order.
 */
export interface TimelineEvent {
  /**
   * Game time in seconds (0 = match start). Ticks are 30s.
   */
  t: number;
  /**
   * Event kind. Drives the payload shape and how the viewer renders/narrates it.
   */
  type:
    | "game_start"
    | "draft_prior"
    | "economy"
    | "laning"
    | "fight"
    | "roshan"
    | "level_up"
    | "item"
    | "objective"
    | "positions"
    | "game_over";
  /**
   * Type-specific fields (documented per-type in docs/02-data-model.md). Kept as a plain JSON object so timelines diff cleanly and stay portable.
   */
  payload: {
    [k: string]: unknown;
  };
}
/**
 * The output of a Monte-Carlo run: one scenario simulated N times, reduced to a win-probability distribution and duration statistics, plus a representative stored SimResult for playback. Produced by the sim CLI --aggregate and served at POST /sims/aggregate.
 */
export interface SimAggregate {
  scenario: SimScenario;
  /**
   * Number of simulations aggregated.
   */
  runs: number;
  /**
   * Fraction of runs Radiant won.
   */
  radiant_win_rate: number;
  duration_seconds: DurationStats;
  /**
   * Counts of games ending in each 5-minute bucket (for a chart).
   */
  duration_histogram: DurationBucket[];
  /**
   * Id of a stored SimResult that typifies the aggregate, for playback.
   */
  representative_sim_id: string;
  /**
   * Rank band whose hero ratings the sims used ('all' = blended across ranks).
   */
  bracket?: "all" | "low" | "mid" | "high";
}
/**
 * The draft that was simulated.
 */
export interface SimScenario {
  /**
   * Patch whose snapshot the heroes are resolved from, e.g. "7.41d".
   */
  patch_id: string;
  /**
   * Radiant hero keys (see snapshot.hero.key), e.g. ["juggernaut", ...].
   *
   * @minItems 1
   * @maxItems 5
   */
  radiant:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string];
  /**
   * Dire hero keys.
   *
   * @minItems 1
   * @maxItems 5
   */
  dire:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string];
}
/**
 * Game-length distribution across runs. The producer (montecarlo) always emits every field; required matches that.
 */
export interface DurationStats {
  mean: number;
  p25: number;
  median: number;
  p75: number;
}
export interface DurationBucket {
  /**
   * Lower edge of the 5-min bucket.
   */
  minute: number;
  count: number;
}
/**
 * Instant draft evaluation: P(radiant wins) from the per-bracket logistic model, no simulation. Served at POST /analysis/draft.
 */
export interface DraftEval {
  patch_id: string;
  /**
   * Rank band the response was scored with.
   */
  bracket: "all" | "low" | "mid" | "high";
  radiant_win_probability: number;
}
/**
 * Per-hero decomposition of a draft's win probability (Coach Lab). Exact, not heuristic: the model is linear in log-odds, so dropping a hero — including their synergy/counter terms — is a real counterfactual. Served at POST /analysis/explain.
 */
export interface DraftExplanation {
  patch_id: string;
  /**
   * Rank band the response was scored with.
   */
  bracket: "all" | "low" | "mid" | "high";
  radiant_win_probability: number;
  /**
   * Sorted by absolute swing, biggest mover first.
   */
  contributions: HeroContribution[];
}
export interface HeroContribution {
  /**
   * Stable hero key (npc_dota_hero_ stripped).
   */
  hero: string;
  /**
   * OpenDota id — the model's id space.
   */
  hero_id: number;
  team: "radiant" | "dire";
  /**
   * Percentage points this hero adds to their OWN team's win probability vs an average pick. Leave-one-out counterfactuals; they do not sum to the total.
   */
  swing: number;
}
/**
 * Ranked candidates for the next pick (Coach Lab). Two orderings exist because measurement showed one isn't enough: by total swing the top-10 barely changes with the board; by fit it is genuinely draft-specific. Served at POST /analysis/suggest.
 */
export interface DraftSuggestions {
  patch_id: string;
  /**
   * Rank band the response was scored with.
   */
  bracket: "all" | "low" | "mid" | "high";
  side: "radiant" | "dire";
  rank_by: "swing" | "fit";
  suggestions: HeroSuggestion[];
}
export interface HeroSuggestion {
  /**
   * Stable hero key (npc_dota_hero_ stripped).
   */
  hero: string;
  hero_id: number;
  /**
   * Total pp gain for the picking side if this hero is added.
   */
  swing: number;
  /**
   * The synergy/counter part of swing — what THIS draft adds beyond the hero being good in general.
   */
  fit: number;
}
/**
 * Which lineup's gold engine the long game favours (Coach Lab). FARM timing, never win timing — the two measurably diverge. Built from outcome-balanced within-team gold shares in parsed real games. Served at POST /analysis/timing.
 */
export interface DraftTiming {
  patch_id: string;
  minutes: number[];
  radiant: TimingSide;
  dire: TimingSide;
  /**
   * 'even' inside the margin rather than manufacturing an edge from noise.
   */
  verdict: "radiant" | "dire" | "even";
  /**
   * |scaling_sum difference| in team-gold share (0.01 = 1pp).
   */
  margin: number;
}
export interface TimingSide {
  /**
   * Lineup's summed within-team share relative to its own minute-5 baseline; null where any measured hero lacks that minute.
   */
  curve_rel: (number | null)[];
  scaling_sum: number;
  measured: number;
  heroes: TimingHero[];
}
export interface TimingHero {
  /**
   * Stable hero key (npc_dota_hero_ stripped).
   */
  hero: string;
  hero_id: number;
  /**
   * Share of TEAM gold this hero's slice moves, minute 5 -> 25 (outcome-balanced). Null = unmeasurable.
   */
  scaling: number | null;
  /**
   * Scaling-bearing games behind the estimate.
   */
  n: number;
  /**
   * True once n clears the artifact's reliability gate.
   */
  gated: boolean;
}
