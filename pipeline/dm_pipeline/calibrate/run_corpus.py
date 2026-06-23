"""Run the prototype sim over real drafts from the harvested corpus.

For a sample of real matches, reconstruct the draft, sim it a few times, and
record everything calibration needs: the sim's win rate, its game durations, and
the draft — next to the real outcome and duration.

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
) -> tuple[dict[int, dict[str, list[int]]], dict[int, bool], dict[int, int]]:
    matches = pl.read_parquet(features_dir / "matches.parquet")
    hero_rows = pl.read_parquet(features_dir / "match_heroes.parquet")

    by_match: dict[int, dict[str, list[int]]] = {}
    for row in hero_rows.iter_rows(named=True):
        teams = by_match.setdefault(row["match_id"], {"radiant": [], "dire": []})
        teams[row["team"]].append(row["hero_id"])

    match_ids = matches["match_id"].to_list()
    win_by_match = dict(zip(match_ids, matches["radiant_win"].to_list()))
    dur_by_match = dict(zip(match_ids, matches["duration"].to_list()))
    return by_match, win_by_match, dur_by_match


def run_sim_corpus(
    features_dir: Path | str,
    heroes: dict[str, dict[str, Any]],
    *,
    patch_id: str,
    sample_size: int = 200,
    seeds: int = 5,
    rng_seed: int = 0,
    ratings: dict[int, float] | None = None,
) -> list[dict[str, Any]]:
    """Sim a sample of real drafts. Returns rich per-draft records.

    Each record carries the draft (hero ids), the real outcome + duration, and
    the sim's win rate + game durations -- enough for win, per-hero, and
    duration calibration. ``heroes`` is the patch's hero data (key -> record
    incl. ``id``); we invert it to map corpus ids back to the keys the sim uses.
    """
    features_dir = Path(features_dir)
    id_to_key = {hero["id"]: key for key, hero in heroes.items()}
    by_match, win_by_match, dur_by_match = _drafts_by_match(features_dir)

    rng = random.Random(rng_seed)
    match_ids = list(by_match.keys())
    rng.shuffle(match_ids)

    records: list[dict[str, Any]] = []
    for match_id in match_ids:
        if len(records) >= sample_size:
            break
        teams = by_match[match_id]
        radiant = [id_to_key.get(h) for h in teams["radiant"]]
        dire = [id_to_key.get(h) for h in teams["dire"]]
        if None in radiant or None in dire:
            continue  # a hero id not present in this patch's snapshot

        scenario = Scenario(patch_id=patch_id, radiant=radiant, dire=dire)  # type: ignore[arg-type]
        radiant_wins = 0
        sim_durations: list[int] = []
        for s in range(seeds):
            # Per-draft seeds: derive each sim's seed from the match id so a
            # single seed's quirks average out across drafts.
            _, state = simulate(
                scenario, heroes, seed=(match_id * 101 + s) & 0x7FFFFFFF, ratings=ratings
            )
            if state.winner == "radiant":
                radiant_wins += 1
            sim_durations.append(state.t)

        records.append(
            {
                "match_id": match_id,
                "radiant_ids": teams["radiant"],
                "dire_ids": teams["dire"],
                "actual_radiant_win": bool(win_by_match[match_id]),
                "actual_duration": int(dur_by_match[match_id]),
                "sim_radiant_winrate": radiant_wins / seeds,
                "sim_durations": sim_durations,
            }
        )
    return records


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
    """Thin projection of run_sim_corpus for the win-accuracy metric."""
    return [
        {
            "match_id": r["match_id"],
            "sim_radiant_winrate": r["sim_radiant_winrate"],
            "actual_radiant_win": r["actual_radiant_win"],
        }
        for r in run_sim_corpus(
            features_dir,
            heroes,
            patch_id=patch_id,
            sample_size=sample_size,
            seeds=seeds,
            rng_seed=rng_seed,
            ratings=ratings,
        )
    ]
