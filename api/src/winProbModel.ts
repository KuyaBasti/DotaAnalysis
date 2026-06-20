import fs from "node:fs";
import path from "node:path";

// The Python trainer exports the logistic-regression coefficients to
// win_probability.coef.json. Since it's a plain linear model on a +1/-1/0 draft
// encoding, scoring is just sigmoid(intercept + weights . draft) -- no sklearn,
// no ONNX runtime needed on this side.
interface Coefficients {
  hero_ids: number[];
  weights: number[];
  intercept: number;
}

export interface WinProbModel {
  /** P(radiant wins) for a draft given as hero ids per side. */
  predict(radiantIds: number[], direIds: number[]): number;
}

export function createWinProbModel(modelsDir: string): WinProbModel | null {
  const file = path.join(modelsDir, "win_probability.coef.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null; // model not trained/exported yet
  }
  const coef = JSON.parse(raw) as Coefficients;
  const weightOf = new Map<number, number>();
  coef.hero_ids.forEach((heroId, j) => weightOf.set(heroId, coef.weights[j]));

  function predict(radiantIds: number[], direIds: number[]): number {
    let score = coef.intercept;
    for (const id of radiantIds) score += weightOf.get(id) ?? 0;
    for (const id of direIds) score -= weightOf.get(id) ?? 0;
    return 1 / (1 + Math.exp(-score));
  }

  return { predict };
}
