"""Tests for rank brackets and bracket-aware ratings/training."""

from __future__ import annotations

import json

import pytest

from dm_pipeline.features.brackets import (
    ALL_BRACKETS,
    BRACKET_KEYS,
    bracket_bounds,
    bracket_for_tier,
    bracket_label,
    normalize,
)
from dm_pipeline.features.build_dataset import build_dataset, hero_strength_ratings


def test_bracket_bounds_and_labels() -> None:
    assert bracket_bounds("low") == (10, 40)
    assert bracket_bounds("high") == (60, 100)
    assert bracket_bounds(ALL_BRACKETS) == (0, 100)
    assert bracket_label("low") == "Herald–Crusader"
    with pytest.raises(ValueError):
        bracket_bounds("immortal_only")


def test_bracket_for_tier_covers_the_ladder() -> None:
    assert bracket_for_tier(15) == "low"      # Herald 5
    assert bracket_for_tier(35) == "low"      # Crusader 5
    assert bracket_for_tier(45) == "mid"      # Archon 5
    assert bracket_for_tier(74) == "high"     # Divine 4
    assert bracket_for_tier(80) == "high"     # Immortal
    assert bracket_for_tier(None) is None     # unranked/unknown


def test_normalize_accepts_known_keys_only() -> None:
    assert normalize(None) == ALL_BRACKETS
    assert normalize("") == ALL_BRACKETS
    assert normalize("HIGH") == "high"
    for key in BRACKET_KEYS:
        assert normalize(key) == key
    with pytest.raises(ValueError):
        normalize("legend")


def _write_match(directory, match_id: int, radiant, dire, radiant_win, rank_tier):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{match_id}.json").write_text(
        json.dumps({
            "match_id": match_id,
            "radiant_team": radiant,
            "dire_team": dire,
            "radiant_win": radiant_win,
            "duration": 1800,
            "game_mode": 22,
            "lobby_type": 7,
            "avg_rank_tier": rank_tier,
            "start_time": 1781457732,
        })
    )


def test_ratings_differ_by_bracket(tmp_path) -> None:
    md, fd = tmp_path / "matches", tmp_path / "features"
    # Hero 1 wins every LOW game and loses every HIGH game — the real pattern
    # (a Sniper-like hero) in miniature.
    for i in range(60):
        _write_match(md, 1000 + i, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True, 25)
    for i in range(60):
        _write_match(md, 2000 + i, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], False, 75)
    build_dataset(matches_dir=md, out_dir=fd)

    low = hero_strength_ratings(fd, bracket="low")
    high = hero_strength_ratings(fd, bracket="high")
    blended = hero_strength_ratings(fd)

    assert low[1] > 1.0 > high[1]          # strong low, weak high
    assert high[1] < blended[1] < low[1]   # blending hides both truths
