"""Run the prototype sim over real drafts from the harvested corpus.

For a sample of real matches, reconstruct the draft, run the sim a few times,
and record the sim's radiant win rate next to the real outcome -- the raw
material for calibration.

This imports the quarantined prototype deliberately: this is the tooling that
*measures* the prototype, which is exactly what the quarantine exists to allow.
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

import polars as pl

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import simulate


def _drafts_by_match(
    features_dir: Path,
) -> tuple[dict[int, dict[str, list[int]]], dict[int, bool]]:
    matches = pl.read_parquet(features_dir / "matches.parquet")
    hero_rows = pl.read_parquet(features_dir / "match_heroes.parquet")

    by_match: dict[int, dict[str, list[int]]] = {}
    for row in hero_rows.iter_rows(named=True):
        teams = by_match.setdefault(row["match_id"], {"radiant": [], "dire": []})
        teams[row["team"]].append(row["hero_id"])

    win_by_match = dict(
        zip(matches["match_id"].to_list(), matches["radiant_win"].to_list())
    )
    return by_match, win_by_match


def run_sim_predictions(
    features_dir: Path | str,
    heroes: dict[str, dict[str, Any]],
    *,
    patch_id: str,
    sample_size: int = 200,
    seeds: int = 5,
    rng_seed: int = 0,
    ratings: dict[int, float] | None = None,
) -> list[dict[str, Any]]:
    """Sim a sample of real drafts. Returns per-match sim win rate vs. reality.

    ``heroes`` is the patch's hero data (key -> record incl. ``id``); we invert
    it to map the corpus's hero ids back to the keys the sim expects.
    """
    features_dir = Path(features_dir)
    id_to_key = {hero["id"]: key for key, hero in heroes.items()}
    by_match, win_by_match = _drafts_by_match(features_dir)

    rng = random.Random(rng_seed)
    match_ids = list(by_match.keys())
    rng.shuffle(match_ids)

    predictions: list[dict[str, Any]] = []
    for match_id in match_ids:
        if len(predictions) >= sample_size:
            break
        teams = by_match[match_id]
        radiant = [id_to_key.get(h) for h in teams["radiant"]]
        dire = [id_to_key.get(h) for h in teams["dire"]]
        if None in radiant or None in dire:
            continue  # a hero id not present in this patch's snapshot

        scenario = Scenario(patch_id=patch_id, radiant=radiant, dire=dire)  # type: ignore[arg-type]
        # Per-draft seeds: derive each sim's seed from the match id so a single
        # seed's quirks average out across drafts. (Reusing the same seeds for
        # every draft made the sim look systematically one-sided.)
        radiant_wins = sum(
            simulate(
                scenario,
                heroes,
                seed=(match_id * 101 + s) & 0x7FFFFFFF,
                ratings=ratings,
            )[1].winner
            == "radiant"
            for s in range(seeds)
        )
        predictions.append(
            {
                "match_id": match_id,
                "sim_radiant_winrate": radiant_wins / seeds,
                "actual_radiant_win": bool(win_by_match[match_id]),
            }
        )
    return predictions
