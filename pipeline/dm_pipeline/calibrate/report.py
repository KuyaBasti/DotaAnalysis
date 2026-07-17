"""Generate a calibration report: sim vs. reality over the real corpus.

Sims a sample of real drafts and scores the sim three ways:
  - win accuracy / Brier (does it pick the winner?),
  - per-hero win-rate correlation r (does it reproduce *which heroes win*?),
  - game-duration gap (do matches last about as long as real ones?).

The latter two are the engine's real targets (the Stage-3 exit criteria) —
win accuracy is capped by draft-only info, but realism is what the sim is for.
"""

from __future__ import annotations

import json

from dm_pipeline import config
from dm_pipeline.calibrate.compare import (
    calibration_metrics,
    duration_comparison,
    hero_winrate_correlation,
)
from dm_pipeline.calibrate.economy import economy_comparison
from dm_pipeline.calibrate.run_corpus import run_sim_corpus
from dm_pipeline.features.build_dataset import hero_strength_ratings
from dm_pipeline.prototype.scenario import load_heroes


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Score the prototype sim against the real match corpus.",
    )
    parser.add_argument("--patch-id", default=config.DEFAULT_PATCH_ID)
    parser.add_argument(
        "--sample",
        type=int,
        default=600,
        help="real drafts to sim (bigger = less noisy estimate)",
    )
    parser.add_argument("--seeds", type=int, default=5, help="sims per draft")
    parser.add_argument(
        "--no-ratings",
        action="store_true",
        help="disable data-derived hero strength (measure the bare engine)",
    )
    args = parser.parse_args(argv)

    heroes = load_heroes(args.patch_id)
    ratings = None if args.no_ratings else hero_strength_ratings(config.FEATURES_DIR)
    records = run_sim_corpus(
        config.FEATURES_DIR,
        heroes,
        patch_id=args.patch_id,
        sample_size=args.sample,
        seeds=args.seeds,
        ratings=ratings,
    )

    win = calibration_metrics(records)
    hero_corr = hero_winrate_correlation(records)
    duration = duration_comparison(records)
    economy = economy_comparison(records)

    report = {
        "patch_id": args.patch_id,
        "seeds_per_draft": args.seeds,
        "hero_strength": not args.no_ratings,
        "win": win,
        "hero_winrate_correlation": hero_corr,
        "duration": duration,
        "economy": economy,
    }
    config.CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)
    out_path = config.CALIBRATION_DIR / f"report.{args.patch_id}.json"
    out_path.write_text(json.dumps(report, indent=2))

    print(json.dumps(report, indent=2))
    print(f"\nwrote {out_path}")
    if win.get("n", 0):
        favorite = max(win["base_rate"], 1 - win["base_rate"])
        print(
            f"\nwin:      acc {win['accuracy']:.3f} vs favorite {favorite:.3f} "
            f"(edge {win['accuracy'] - favorite:+.3f}), Brier {win['brier']:.3f}"
        )
        r = hero_corr.get("r")
        print(
            f"realism:  per-hero win-rate r = "
            f"{r if r is None else f'{r:.3f}'} (target >0.8, n={hero_corr['n_heroes']} heroes); "
            f"duration sim {duration['sim_mean_min']}m vs real "
            f"{duration['real_mean_min']}m (gap {duration['gap_min']:+}m)"
        )
        if economy:
            parts = ", ".join(
                f"min {m}: sim {v['sim']:,.0f} vs real {v['real']:,.0f} (x{v['ratio']})"
                for m, v in economy.items()
            )
            print(f"economy:  team net worth — {parts}")


if __name__ == "__main__":
    main()
