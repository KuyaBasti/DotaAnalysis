"""Generate a calibration report: sim vs. reality over the real corpus.

Loads the patch heroes + feature dataset, sims a sample of real drafts, scores
the sim's predictions against actual outcomes, and writes/prints the report.
The Stage-3 exit criterion lives here: how close is the sim to reality?
"""

from __future__ import annotations

import json

from dm_pipeline import config
from dm_pipeline.calibrate.compare import calibration_metrics
from dm_pipeline.calibrate.run_corpus import run_sim_predictions
from dm_pipeline.prototype.scenario import load_heroes


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Score the prototype sim against the real match corpus.",
    )
    parser.add_argument("--patch-id", default=config.DEFAULT_PATCH_ID)
    parser.add_argument("--sample", type=int, default=200, help="real drafts to sim")
    parser.add_argument("--seeds", type=int, default=5, help="sims per draft")
    args = parser.parse_args(argv)

    heroes = load_heroes(args.patch_id)
    predictions = run_sim_predictions(
        config.FEATURES_DIR,
        heroes,
        patch_id=args.patch_id,
        sample_size=args.sample,
        seeds=args.seeds,
    )
    metrics = calibration_metrics(predictions)

    report = {"patch_id": args.patch_id, "seeds_per_draft": args.seeds, **metrics}
    config.CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)
    out_path = config.CALIBRATION_DIR / f"report.{args.patch_id}.json"
    out_path.write_text(json.dumps(report, indent=2))

    print(json.dumps(report, indent=2))
    print(f"\nwrote {out_path}")
    if metrics.get("n", 0):
        edge = metrics["accuracy"] - max(metrics["base_rate"], 1 - metrics["base_rate"])
        print(
            f"sim accuracy {metrics['accuracy']:.3f} vs. always-pick-favorite "
            f"{max(metrics['base_rate'], 1 - metrics['base_rate']):.3f} "
            f"(edge {edge:+.3f}); Brier {metrics['brier']:.3f}"
        )


if __name__ == "__main__":
    main()
