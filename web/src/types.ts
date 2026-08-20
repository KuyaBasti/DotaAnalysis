// The response shapes that have schemas in schemas/ are GENERATED — one source
// of truth with the API's runtime validation (ajv in api/tests). Regenerate
// with `npm run generate:types`; a freshness test fails when the schemas and
// the generated file disagree.
export type {
  DraftEval,
  DraftExplanation,
  DraftSuggestions,
  DraftTiming,
  DurationBucket,
  DurationStats,
  HeroContribution,
  HeroSuggestion,
  SimAggregate,
  SimResult,
  SimScenario,
  SimSummary,
  TimelineEvent,
  TimingHero,
  TimingSide,
} from "./types/generated";

// The pre-schema name for DraftEval, kept so call sites read naturally.
export type { DraftEval as DraftEvalResponse } from "./types/generated";

// --- Thin API envelopes without schemas (hand-written, trivially stable) ----

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

export interface SimsResponse {
  sims: string[];
}
