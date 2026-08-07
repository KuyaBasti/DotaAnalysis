import fs from "node:fs";
import path from "node:path";

// The Python trainer exports the logistic-regression coefficients to
// win_probability[.<bracket>].coef.json. Since it's a plain linear model on a
// +1/-1/0 draft encoding, scoring is just sigmoid(intercept + weights . draft)
// -- no sklearn, no ONNX runtime needed on this side.
interface Coefficients {
  hero_ids: number[];
  weights: number[];
  intercept: number;
}

/** Rank bands the models are trained per (mirrors features/brackets.py). */
export const BRACKETS = ["all", "low", "mid", "high"] as const;
export type Bracket = (typeof BRACKETS)[number];

export function isBracket(value: unknown): value is Bracket {
  return typeof value === "string" && (BRACKETS as readonly string[]).includes(value);
}

/** One hero's share of the blame or credit for a draft's win probability. */
export interface HeroContribution {
  hero_id: number;
  team: "radiant" | "dire";
  /**
   * Percentage points this hero adds to *their own team's* win probability,
   * versus an average hero (weight 0) in the same slot. Positive = helping.
   *
   * These are leave-one-out counterfactuals, so they do NOT sum to the total:
   * the model is linear in log-odds, not in probability.
   */
  swing: number;
}

export interface DraftExplanation {
  radiant_win_probability: number;
  /** Sorted by absolute swing, biggest mover first. */
  contributions: HeroContribution[];
}

/** A candidate for the next pick, scored against the draft so far. */
export interface HeroSuggestion {
  hero_id: number;
  /** Percentage points this pick adds to the drafting side's win probability. */
  swing: number;
  /**
   * The part of `swing` that comes from synergy/counter terms — i.e. from *this
   * draft* rather than the hero being good in general. Worth surfacing: if it
   * is ~0 across the board, the ranking is a tier list wearing a coach's hat.
   */
  fit: number;
}

export interface WinProbModel {
  /** P(radiant wins) for a draft, scored by the given bracket's model. */
  predict(radiantIds: number[], direIds: number[], bracket?: Bracket): number;
  /** Per-hero decomposition of that probability. */
  explain(
    radiantIds: number[],
    direIds: number[],
    bracket?: Bracket,
  ): DraftExplanation;
  /**
   * Rank candidate heroes for `side`'s next pick, best first.
   *
   * `rankBy` matters more than it looks. By `swing` the list is dominated by
   * how good a hero is in general — measured, the top ten barely move as the
   * draft changes (6-9 of 10 hold). By `fit` it ranks purely on synergy and
   * counters, and then it is genuinely about *this* draft (0-3 of 10 hold
   * across different boards).
   */
  suggest(
    radiantIds: number[],
    direIds: number[],
    side: "radiant" | "dire",
    candidateIds: number[],
    bracket?: Bracket,
    rankBy?: "swing" | "fit",
  ): HeroSuggestion[];
  /** Brackets that actually have a trained model on disk. */
  available(): Bracket[];
}

function loadCoefficients(modelsDir: string, bracket: Bracket): Coefficients | null {
  // 'all' keeps the original (legacy) filename; brackets are suffixed.
  const stem = bracket === "all" ? "win_probability" : `win_probability.${bracket}`;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(modelsDir, `${stem}.coef.json`), "utf8"),
    ) as Coefficients;
  } catch {
    return null; // that bracket isn't trained yet
  }
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

interface Scorer {
  weightOf: Map<number, number>;
  intercept: number;
}

/**
 * Blended synergy/counter weights (see pairs.py). Keyed by hero *id* pairs, so
 * this file is self-describing and can't drift from the trainer's ordering.
 */
interface PairCoefficients {
  synergy: [number, number, number][];
  counter: [number, number, number][];
  alpha: Record<string, number>;
  /**
   * Per-bracket Platt rescale [a, b] applied to the combined score. alpha is
   * chosen on AUC, which is blind to probability scale, so without this the
   * hybrid ranks better while reading *more* over-confident than the hero
   * model. Absent for a bracket => identity.
   */
  calibration?: Record<string, [number, number]>;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function loadPairs(modelsDir: string): PairCoefficients | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(modelsDir, "win_probability.pairs.coef.json"), "utf8"),
    ) as PairCoefficients;
  } catch {
    return null; // pair terms not trained yet; the model degrades to hero-only
  }
}

export function createWinProbModel(modelsDir: string): WinProbModel | null {
  const scorers = new Map<Bracket, Scorer>();

  for (const bracket of BRACKETS) {
    const coef = loadCoefficients(modelsDir, bracket);
    if (!coef) continue;
    const weightOf = new Map<number, number>();
    coef.hero_ids.forEach((heroId, j) => weightOf.set(heroId, coef.weights[j]));
    scorers.set(bracket, { weightOf, intercept: coef.intercept });
  }

  if (!scorers.has("all")) return null; // nothing trained/exported yet

  const pairs = loadPairs(modelsDir);
  const synergyOf = new Map<string, number>();
  const counterOf = new Map<string, number>();
  for (const [a, b, w] of pairs?.synergy ?? []) synergyOf.set(pairKey(a, b), w);
  for (const [a, b, w] of pairs?.counter ?? []) counterOf.set(pairKey(a, b), w);
  const alphaFor = (bracket: Bracket) => pairs?.alpha?.[bracket] ?? 0;

  // Fall back to the blended model if that bracket isn't trained.
  const scorerFor = (bracket: Bracket) => scorers.get(bracket) ?? scorers.get("all")!;

  /**
   * Synergy + counter contribution to the radiant log-odds, before alpha.
   * Antisymmetric: swapping the two teams negates it.
   */
  function pairLogOdds(radiantIds: number[], direIds: number[]): number {
    if (synergyOf.size === 0 && counterOf.size === 0) return 0;
    let score = 0;
    for (const [team, sign] of [
      [radiantIds, 1],
      [direIds, -1],
    ] as const) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          score += sign * (synergyOf.get(pairKey(team[i], team[j])) ?? 0);
        }
      }
    }
    for (const r of radiantIds) {
      for (const d of direIds) {
        // Stored as "a on radiant vs b on dire" with a < b, so the reverse
        // orientation is the same weight negated.
        const w = counterOf.get(pairKey(r, d)) ?? 0;
        score += r < d ? w : -w;
      }
    }
    return score;
  }

  /**
   * Log-odds of a radiant win: (hero terms + alpha * pair terms), rescaled.
   *
   * `withPairs: false` scores the hero terms alone, which is how a suggestion
   * separates "this hero is good" from "this hero fits this draft".
   */
  function logOdds(
    bracket: Bracket,
    radiantIds: number[],
    direIds: number[],
    withPairs = true,
  ): number {
    const { weightOf, intercept } = scorerFor(bracket);
    let score = intercept;
    for (const id of radiantIds) score += weightOf.get(id) ?? 0;
    for (const id of direIds) score -= weightOf.get(id) ?? 0;
    if (withPairs) score += alphaFor(bracket) * pairLogOdds(radiantIds, direIds);

    const [a, b] = pairs?.calibration?.[bracket] ?? [1, 0];
    return a * score + b;
  }

  /** P(the drafting side wins), from that side's point of view. */
  function sideProb(
    bracket: Bracket,
    radiantIds: number[],
    direIds: number[],
    side: "radiant" | "dire",
    withPairs = true,
  ): number {
    const p = sigmoid(logOdds(bracket, radiantIds, direIds, withPairs));
    return side === "radiant" ? p : 1 - p;
  }

  return {
    predict(radiantIds, direIds, bracket = "all") {
      return sigmoid(logOdds(bracket, radiantIds, direIds));
    },

    explain(radiantIds, direIds, bracket = "all") {
      const full = logOdds(bracket, radiantIds, direIds);
      const probability = sigmoid(full);

      // Dropping a hero is the counterfactual "an average hero played this slot
      // instead" — average meaning zero weight AND no synergy or counter with
      // anyone. Rescoring the smaller draft applies all of that at once, rather
      // than re-deriving the delta by hand.
      const contributions: HeroContribution[] = [
        ...radiantIds.map((id) => ({ id, team: "radiant" as const })),
        ...direIds.map((id) => ({ id, team: "dire" as const })),
      ].map(({ id, team }) => {
        const without = sigmoid(
          team === "radiant"
            ? logOdds(bracket, radiantIds.filter((h) => h !== id), direIds)
            : logOdds(bracket, radiantIds, direIds.filter((h) => h !== id)),
        );
        // Express the swing from the hero's own team's point of view, so a
        // strong hero always reads positive whichever side they're on.
        const gain = team === "radiant" ? probability - without : without - probability;
        return { hero_id: id, team, swing: Number((gain * 100).toFixed(2)) };
      });

      contributions.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
      return {
        radiant_win_probability: Number(probability.toFixed(4)),
        contributions,
      };
    },

    suggest(radiantIds, direIds, side, candidateIds, bracket = "all", rankBy = "swing") {
      const drafted = new Set([...radiantIds, ...direIds]);
      const base = sideProb(bracket, radiantIds, direIds, side);
      const baseNoPairs = sideProb(bracket, radiantIds, direIds, side, false);

      const out: HeroSuggestion[] = [];
      for (const id of candidateIds) {
        if (drafted.has(id)) continue; // already picked, by either side
        const radiant = side === "radiant" ? [...radiantIds, id] : radiantIds;
        const dire = side === "dire" ? [...direIds, id] : direIds;

        const swing = sideProb(bracket, radiant, dire, side) - base;
        // The same delta with pair terms switched off is what the hero is worth
        // in the abstract; the remainder is what this particular draft adds.
        const solo = sideProb(bracket, radiant, dire, side, false) - baseNoPairs;
        out.push({
          hero_id: id,
          swing: Number((swing * 100).toFixed(2)),
          fit: Number(((swing - solo) * 100).toFixed(2)),
        });
      }

      out.sort((a, b) => b[rankBy] - a[rankBy]);
      return out;
    },

    available: () => [...scorers.keys()],
  };
}
