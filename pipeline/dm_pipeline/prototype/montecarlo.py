"""Monte-Carlo aggregation: run one draft N times for a win-probability distribution.

A single simulation is one game (and one winner). Running the same draft many
times — each with its own seed — turns that into a *distribution*: how often
Radiant wins, how long games run, and a representative game to watch. This is
the analysis layer on top of the deterministic engine.

The compute mirrors the calibration harness (which already sims N times per
draft); here the aggregate is the product, not a calibration score.
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Any

from dm_pipeline import config
from dm_pipeline.prototype.scenario import Scenario, load_heroes
from dm_pipeline.prototype.sim_loop import (
    load_default_builds,
    load_default_ratings,
    sim_result,
    simulate,
)

HISTOGRAM_BUCKET_MINUTES = 5


def _seed_for(base_seed: int, i: int) -> int:
    """Distinct, reproducible per-run seed derived from the request seed."""
    return (base_seed * 1_000_003 + i) & 0x7FFFFFFF


def _percentile(sorted_vals: list[int], p: float) -> int:
    return sorted_vals[min(int(p * len(sorted_vals)), len(sorted_vals) - 1)]


def aggregate_scenario(
    scenario: Scenario,
    heroes: dict[str, dict[str, Any]],
    *,
    runs: int = 200,
    base_seed: int = 1,
    ratings: dict[int, float] | None = None,
    builds: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], int]:
    """Run ``scenario`` ``runs`` times. Returns (aggregate, representative_seed).

    The representative seed is a run whose winner is the majority side and whose
    duration is closest to the median — the game that best typifies the spread.
    """
    if runs < 1:
        raise ValueError("runs must be >= 1")

    radiant_wins = 0
    durations: list[int] = []
    per_run: list[tuple[int, str, int]] = []  # (seed, winner, duration_seconds)
    for i in range(runs):
        seed = _seed_for(base_seed, i)
        _, state = simulate(
            scenario, heroes, seed=seed, ratings=ratings, builds=builds
        )
        durations.append(state.t)
        radiant_wins += state.winner == "radiant"
        per_run.append((seed, state.winner or "radiant", state.t))

    win_rate = radiant_wins / runs
    median_dur = statistics.median(durations)
    majority = "radiant" if win_rate >= 0.5 else "dire"
    representative = min(
        (r for r in per_run if r[1] == majority),
        key=lambda r: abs(r[2] - median_dur),
        default=per_run[0],
    )

    durations_sorted = sorted(durations)
    histogram: dict[int, int] = {}
    for d in durations:
        bucket = (d // 60 // HISTOGRAM_BUCKET_MINUTES) * HISTOGRAM_BUCKET_MINUTES
        histogram[bucket] = histogram.get(bucket, 0) + 1

    aggregate = {
        "scenario": {
            "patch_id": scenario.patch_id,
            "radiant": scenario.radiant,
            "dire": scenario.dire,
        },
        "runs": runs,
        "radiant_win_rate": round(win_rate, 4),
        "duration_seconds": {
            "mean": round(statistics.mean(durations), 1),
            "p25": _percentile(durations_sorted, 0.25),
            "median": round(median_dur, 1),
            "p75": _percentile(durations_sorted, 0.75),
        },
        "duration_histogram": [
            {"minute": m, "count": histogram[m]} for m in sorted(histogram)
        ],
        "representative_sim_id": f"{scenario.patch_id}-seed{representative[0]}",
    }
    return aggregate, representative[0]


def run_and_export(
    scenario: Scenario,
    *,
    runs: int = 200,
    base_seed: int = 1,
    sim_dir: Path | str | None = None,
    bracket: str = "all",
    heroes: dict[str, dict[str, Any]] | None = None,
    ratings: dict[int, float] | None = None,
    builds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Aggregate a draft and export the representative game so it's watchable.

    By default uses the on-disk snapshot plus the same ratings + builds as the
    watched single-sim path (so the aggregate reflects hero identity and item
    timings); tests inject ``heroes`` to stay offline.
    """
    if heroes is None:
        heroes = load_heroes(scenario.patch_id)
        ratings = load_default_ratings(bracket) if ratings is None else ratings
        builds = load_default_builds() if builds is None else builds
    aggregate, rep_seed = aggregate_scenario(
        scenario, heroes, runs=runs, base_seed=base_seed, ratings=ratings, builds=builds
    )
    aggregate["bracket"] = bracket

    # Re-run the representative seed and export its full timeline for playback.
    timeline, state = simulate(
        scenario, heroes, seed=rep_seed, ratings=ratings, builds=builds
    )
    result = sim_result(scenario, timeline, state, seed=rep_seed)
    sim_dir = Path(sim_dir) if sim_dir is not None else config.SIM_OUT_DIR
    sim_dir.mkdir(parents=True, exist_ok=True)
    (sim_dir / f"sim.{result['id']}.json").write_text(
        json.dumps(result, indent=2, sort_keys=True)
    )
    return aggregate


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Monte-Carlo: run a draft N times → aggregate JSON on stdout.",
    )
    parser.add_argument("--radiant", required=True, help="comma-separated hero keys")
    parser.add_argument("--dire", required=True, help="comma-separated hero keys")
    parser.add_argument("--patch", default=config.DEFAULT_PATCH_ID)
    parser.add_argument("--runs", type=int, default=200)
    parser.add_argument("--seed", type=int, default=1, help="base seed (per-run seeds derive from it)")
    parser.add_argument("--bracket", default="all", help="rank bracket: all/low/mid/high")
    args = parser.parse_args(argv)

    radiant = [k.strip() for k in args.radiant.split(",") if k.strip()]
    dire = [k.strip() for k in args.dire.split(",") if k.strip()]
    scenario = Scenario(patch_id=args.patch, radiant=radiant, dire=dire)
    aggregate = run_and_export(
        scenario, runs=args.runs, base_seed=args.seed, bracket=args.bracket
    )
    print(json.dumps(aggregate))


if __name__ == "__main__":
    main()
