import fs from "node:fs";
import path from "node:path";

// dm-trajectories exports per-hero farm-timing signatures: an outcome-balanced
// within-team gold-share curve, a scaling delta (share@25 - share@5), and a
// coverage-gate flag. Keyed by hero id, so this file is self-describing — the
// same convention as the pair-weights artifact.
interface HeroTrajectory {
  curve: (number | null)[];
  scaling: number | null;
  n_scaling: number;
  gated: boolean;
}

interface TrajectoryArtifact {
  minutes: number[];
  games_used: number;
  gate_min_scaling_games: number;
  heroes: Record<string, HeroTrajectory>;
}

/** One drafted hero's timing contribution, for display. */
export interface TimingHero {
  hero_id: number;
  /** Percentage points of TEAM gold this hero's share moves, minute 5 -> 25. */
  scaling: number | null;
  n: number;
  gated: boolean;
}

export interface TimingSide {
  /**
   * The lineup's summed share drift, relative to its own minute-5 baseline —
   * "how much more of a team's gold these five historically claim at minute m
   * than early". Null where any measured hero lacks that minute.
   */
  curve_rel: (number | null)[];
  /** Sum of the measured heroes' scaling deltas. */
  scaling_sum: number;
  /** How many of the five have a measurable scaling (the rest are unknown). */
  measured: number;
  heroes: TimingHero[];
}

export interface DraftTiming {
  minutes: number[];
  radiant: TimingSide;
  dire: TimingSide;
  /** Which side the long game favours, or "even" inside the margin. */
  verdict: "radiant" | "dire" | "even";
  /** |scaling_sum difference|, in team-gold share (0.01 = 1pp). */
  margin: number;
}

export interface TimingModel {
  timing(radiantIds: number[], direIds: number[]): DraftTiming;
}

// Below this scaling-sum gap the honest read is "no meaningful timing edge".
const EVEN_MARGIN = 0.01;

export function createTimingModel(modelsDir: string): TimingModel | null {
  let art: TrajectoryArtifact;
  try {
    art = JSON.parse(
      fs.readFileSync(path.join(modelsDir, "hero_trajectories.json"), "utf8"),
    ) as TrajectoryArtifact;
  } catch {
    return null; // not extracted yet — the route reports the feature as absent
  }

  function side(ids: number[]): TimingSide {
    const rows = ids.map((id) => art.heroes[String(id)]);
    const heroes: TimingHero[] = ids.map((id, i) => ({
      hero_id: id,
      scaling: rows[i]?.scaling ?? null,
      n: rows[i]?.n_scaling ?? 0,
      gated: rows[i]?.gated ?? false,
    }));

    const measuredRows = rows.filter(
      (r): r is HeroTrajectory => r !== undefined && r.scaling !== null,
    );
    const scalingSum = measuredRows.reduce((s, r) => s + (r.scaling ?? 0), 0);

    // Summed curve relative to the lineup's own minute-5 total; a minute is
    // null unless every measured hero has it (partial sums would silently
    // change which heroes are being compared across minutes).
    const curve_rel = art.minutes.map((_, mi) => {
      if (measuredRows.length === 0) return null;
      let total = 0;
      let base = 0;
      for (const r of measuredRows) {
        const v = r.curve[mi];
        const b = r.curve[0];
        if (v === null || b === null) return null;
        total += v;
        base += b;
      }
      return total - base;
    });

    return {
      curve_rel: curve_rel.map((v) => (v === null ? null : Number(v.toFixed(5)))),
      scaling_sum: Number(scalingSum.toFixed(5)),
      measured: measuredRows.length,
      heroes,
    };
  }

  return {
    timing(radiantIds, direIds) {
      const radiant = side(radiantIds);
      const dire = side(direIds);
      const diff = radiant.scaling_sum - dire.scaling_sum;
      return {
        minutes: art.minutes,
        radiant,
        dire,
        verdict:
          Math.abs(diff) < EVEN_MARGIN ? "even" : diff > 0 ? "radiant" : "dire",
        margin: Number(Math.abs(diff).toFixed(5)),
      };
    },
  };
}
