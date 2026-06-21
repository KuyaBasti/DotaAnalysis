"""Tests for the calibration harness."""

from __future__ import annotations

from pathlib import Path

import polars as pl

from dm_pipeline.calibrate.compare import calibration_metrics
from dm_pipeline.calibrate.run_corpus import run_sim_predictions

# Minimal heroes (key -> record with the fields the sim + id-mapping need).
HEROES = {
    f"h{i}": {
        "id": i,
        "display_name": f"H{i}",
        "roles": ["carry"] if i % 2 else ["support"],
        "attack_type": "melee" if i % 2 else "ranged",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    }
    for i in range(1, 11)
}


def test_calibration_metrics_perfect_predictions() -> None:
    preds = [
        {"sim_radiant_winrate": 1.0, "actual_radiant_win": True},
        {"sim_radiant_winrate": 0.0, "actual_radiant_win": False},
    ]
    m = calibration_metrics(preds)
    assert m["n"] == 2
    assert m["accuracy"] == 1.0
    assert m["brier"] == 0.0
    assert m["base_rate"] == 0.5


def test_calibration_metrics_coin_flip() -> None:
    preds = [{"sim_radiant_winrate": 0.5, "actual_radiant_win": True} for _ in range(4)]
    m = calibration_metrics(preds)
    assert m["brier"] == 0.25  # always guessing 0.5
    assert m["base_rate"] == 1.0


def test_calibration_metrics_empty() -> None:
    assert calibration_metrics([]) == {"n": 0}


def _write_features(tmp_path: Path) -> Path:
    fd = tmp_path / "features"
    fd.mkdir(parents=True)
    matches = [{"match_id": i, "radiant_win": i % 2 == 0} for i in range(8)]
    hero_rows = []
    for i in range(8):
        for h in [1, 2, 3, 4, 5]:
            hero_rows.append({"match_id": i, "team": "radiant", "hero_id": h})
        for h in [6, 7, 8, 9, 10]:
            hero_rows.append({"match_id": i, "team": "dire", "hero_id": h})
    pl.DataFrame(matches).write_parquet(fd / "matches.parquet")
    pl.DataFrame(hero_rows).write_parquet(fd / "match_heroes.parquet")
    return fd


def test_run_sim_predictions_shape(tmp_path) -> None:
    fd = _write_features(tmp_path)
    preds = run_sim_predictions(
        fd, HEROES, patch_id="test", sample_size=5, seeds=3
    )

    assert 0 < len(preds) <= 5
    for p in preds:
        assert 0.0 <= p["sim_radiant_winrate"] <= 1.0
        assert isinstance(p["actual_radiant_win"], bool)
    # metrics flow through end to end
    m = calibration_metrics(preds)
    assert 0.0 <= m["accuracy"] <= 1.0
    assert 0.0 <= m["brier"] <= 1.0
