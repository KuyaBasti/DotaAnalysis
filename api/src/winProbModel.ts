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

export interface WinProbModel {
  /** P(radiant wins) for a draft, scored by the given bracket's model. */
  predict(radiantIds: number[], direIds: number[], bracket?: Bracket): number;
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

export function createWinProbModel(modelsDir: string): WinProbModel | null {
  const scorers = new Map<Bracket, (r: number[], d: number[]) => number>();

  for (const bracket of BRACKETS) {
    const coef = loadCoefficients(modelsDir, bracket);
    if (!coef) continue;
    const weightOf = new Map<number, number>();
    coef.hero_ids.forEach((heroId, j) => weightOf.set(heroId, coef.weights[j]));
    scorers.set(bracket, (radiantIds, direIds) => {
      let score = coef.intercept;
      for (const id of radiantIds) score += weightOf.get(id) ?? 0;
      for (const id of direIds) score -= weightOf.get(id) ?? 0;
      return 1 / (1 + Math.exp(-score));
    });
  }

  if (!scorers.has("all")) return null; // nothing trained/exported yet

  return {
    predict(radiantIds, direIds, bracket = "all") {
      // Fall back to the blended model if that bracket isn't trained.
      const score = scorers.get(bracket) ?? scorers.get("all")!;
      return score(radiantIds, direIds);
    },
    available: () => [...scorers.keys()],
  };
}
