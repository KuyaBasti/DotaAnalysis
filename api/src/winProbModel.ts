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

export interface WinProbModel {
  /** P(radiant wins) for a draft, scored by the given bracket's model. */
  predict(radiantIds: number[], direIds: number[], bracket?: Bracket): number;
  /** Per-hero decomposition of that probability. */
  explain(
    radiantIds: number[],
    direIds: number[],
    bracket?: Bracket,
  ): DraftExplanation;
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

  // Fall back to the blended model if that bracket isn't trained.
  const scorerFor = (bracket: Bracket) => scorers.get(bracket) ?? scorers.get("all")!;

  /** Log-odds of a radiant win: intercept + sum(weights . draft). */
  function logOdds(
    { weightOf, intercept }: Scorer,
    radiantIds: number[],
    direIds: number[],
  ): number {
    let score = intercept;
    for (const id of radiantIds) score += weightOf.get(id) ?? 0;
    for (const id of direIds) score -= weightOf.get(id) ?? 0;
    return score;
  }

  return {
    predict(radiantIds, direIds, bracket = "all") {
      return sigmoid(logOdds(scorerFor(bracket), radiantIds, direIds));
    },

    explain(radiantIds, direIds, bracket = "all") {
      const scorer = scorerFor(bracket);
      const full = logOdds(scorer, radiantIds, direIds);
      const probability = sigmoid(full);

      // Each hero's signed effect on the *radiant* log-odds; dropping it is the
      // counterfactual "an average hero played this slot instead".
      const contributions: HeroContribution[] = [
        ...radiantIds.map((id) => ({ id, team: "radiant" as const, sign: 1 })),
        ...direIds.map((id) => ({ id, team: "dire" as const, sign: -1 })),
      ].map(({ id, team, sign }) => {
        const effect = sign * (scorer.weightOf.get(id) ?? 0);
        const without = sigmoid(full - effect);
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

    available: () => [...scorers.keys()],
  };
}
