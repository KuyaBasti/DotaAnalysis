"""Tests for the draft -> win-probability model."""

from __future__ import annotations

from pathlib import Path

import polars as pl

from dm_pipeline.models.win_probability.predict import draft_to_vector, predict_draft
from dm_pipeline.models.win_probability.train import load_draft_matrix, train


def _make_dataset(tmp_path: Path, n: int = 200) -> Path:
    """Synthetic dataset where the draft perfectly decides the winner.

    Half the matches put hero 1 on radiant (and radiant wins); the other half
    put heroes 11-15 on radiant (and dire wins). A learner should nail this.
    """
    matches: list[dict] = []
    hero_rows: list[dict] = []
    dire = [6, 7, 8, 9, 10]
    for match_id in range(n):
        radiant_has_hero1 = match_id % 2 == 0
        radiant = [1, 2, 3, 4, 5] if radiant_has_hero1 else [11, 12, 13, 14, 15]
        matches.append(
            {
                "match_id": match_id,
                "start_time": 0,
                "duration": 1200,
                "game_mode": 23,
                "lobby_type": 0,
                "avg_rank_tier": 40,
                "radiant_win": radiant_has_hero1,
            }
        )
        for hero_id in radiant:
            hero_rows.append(
                {"match_id": match_id, "team": "radiant", "hero_id": hero_id}
            )
        for hero_id in dire:
            hero_rows.append(
                {"match_id": match_id, "team": "dire", "hero_id": hero_id}
            )

    fd = tmp_path / "features"
    fd.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(matches).write_parquet(fd / "matches.parquet")
    pl.DataFrame(hero_rows).write_parquet(fd / "match_heroes.parquet")
    return fd


def test_draft_matrix_encoding(tmp_path) -> None:
    fd = _make_dataset(tmp_path, n=10)
    X, y, hero_ids = load_draft_matrix(fd)

    assert X.shape == (10, len(hero_ids))
    assert set(X.flatten().tolist()) <= {-1.0, 0.0, 1.0}
    assert set(y.tolist()) == {0, 1}


def test_model_learns_a_predictive_draft(tmp_path) -> None:
    fd = _make_dataset(tmp_path, n=240)
    result = train(fd)

    # The draft fully determines the outcome here, so the model should ace it.
    assert result.auc > 0.9
    assert result.n_test > 0


def test_draft_to_vector_encoding() -> None:
    x = draft_to_vector([1, 2], [3, 4], hero_ids=[1, 2, 3, 4, 5])
    assert x.tolist() == [1.0, 1.0, -1.0, -1.0, 0.0]  # +1 radiant, -1 dire, 0 absent


def test_predict_draft_favors_the_winning_hero(tmp_path) -> None:
    result = train(_make_dataset(tmp_path, n=240))
    bundle = {"model": result.model, "hero_ids": result.hero_ids}

    # Radiant with the always-winning hero 1 should be favored; without it, not.
    p_with = predict_draft(bundle, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10])
    p_without = predict_draft(bundle, [11, 12, 13, 14, 15], [6, 7, 8, 9, 10])
    assert p_with > 0.5 > p_without
