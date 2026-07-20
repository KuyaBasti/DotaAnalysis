"""Tests for the match feature-extraction dataset."""

from __future__ import annotations

import json
from pathlib import Path

from dm_pipeline.features.build_dataset import (
    build_dataset,
    extract_rows,
    hero_strength_ratings,
    hero_win_rates,
)


def _write_match(
    directory: Path,
    match_id: int,
    radiant: list[int],
    dire: list[int],
    radiant_win: bool,
    duration: int = 1200,
    game_mode: int = 22,  # ranked All Draft (the project's only mode)
    lobby_type: int = 7,
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{match_id}.json").write_text(
        json.dumps(
            {
                "match_id": match_id,
                "radiant_team": radiant,
                "dire_team": dire,
                "radiant_win": radiant_win,
                "duration": duration,
                "game_mode": game_mode,
                "lobby_type": lobby_type,
                "avg_rank_tier": 40,
                "start_time": 1781457732,
            }
        )
    )


def test_extract_skips_low_quality(tmp_path) -> None:
    md = tmp_path / "matches"
    _write_match(md, 1, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True)
    _write_match(md, 2, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], False, duration=0)
    _write_match(md, 3, [0, 0, 0, 0, 0], [6, 7, 8, 9, 10], True)  # missing heroes

    match_rows, hero_rows = extract_rows(md)

    assert [m["match_id"] for m in match_rows] == [1]  # 2 unfinished, 3 no heroes
    assert len(hero_rows) == 10  # only match 1, a full 5v5
    assert {h["team"] for h in hero_rows} == {"radiant", "dire"}


def test_extract_keeps_ranked_matches_only(tmp_path) -> None:
    md = tmp_path / "matches"
    _write_match(md, 1, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True)
    _write_match(md, 2, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True, game_mode=23, lobby_type=0)  # turbo
    _write_match(md, 3, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True, lobby_type=0)  # unranked AD

    match_rows, _ = extract_rows(md)

    assert [m["match_id"] for m in match_rows] == [1]


def test_build_and_hero_win_rates(tmp_path) -> None:
    md = tmp_path / "matches"
    fd = tmp_path / "features"
    # Hero 1 is always on the winning (radiant) side; hero 6 always loses (dire).
    for i in range(25):
        _write_match(md, 1000 + i, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True)

    summary = build_dataset(matches_dir=md, out_dir=fd)
    assert summary["matches"] == 25
    assert summary["hero_rows"] == 250

    rates = {
        row["hero_id"]: row["win_rate"]
        for row in hero_win_rates(features_dir=fd, min_games=20).iter_rows(named=True)
    }
    assert rates[1] == 1.0  # always on the winning side
    assert rates[6] == 0.0  # always on the losing side


def test_hero_strength_ratings(tmp_path) -> None:
    md = tmp_path / "matches"
    fd = tmp_path / "features"
    # hero 1 always wins (radiant), hero 6 always loses (dire).
    for i in range(40):
        _write_match(md, 1000 + i, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True)
    build_dataset(matches_dir=md, out_dir=fd)

    ratings = hero_strength_ratings(fd)
    assert ratings[1] > 1.0  # strong hero farms more
    assert ratings[6] < 1.0  # weak hero farms less
    assert 0.5 < ratings[1] < 1.5  # shrinkage keeps it bounded


def test_extract_respects_min_rank(tmp_path) -> None:
    md = tmp_path / "matches"
    _write_match(md, 1, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True)  # rank 40 fixture
    _write_match(md, 2, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], True)
    # bump match 2 to Divine
    import json as _json
    rec = _json.loads((md / "2.json").read_text())
    rec["avg_rank_tier"] = 74
    (md / "2.json").write_text(_json.dumps(rec))

    match_rows, _ = extract_rows(md, min_rank=70)
    assert [m["match_id"] for m in match_rows] == [2]


def test_hero_builds_extraction(tmp_path) -> None:
    import json as _json
    from dm_pipeline.features.builds import build_hero_builds

    details = tmp_path / "details"
    details.mkdir()
    snapshot = {
        "items": [
            {"key": "battle_fury", "display_name": "Battle Fury", "cost": 3900},
            {"key": "manta", "display_name": "Manta Style", "cost": 4650},
            {"key": "tango", "display_name": "Tango", "cost": 90},
        ],
        "heroes": [],
    }
    # 5 games where hero 1 always builds Battle Fury then Manta (Tango ignored).
    for i in range(5):
        (details / f"{i}.json").write_text(_json.dumps({"players": [{
            "hero_id": 1,
            "gold_t": [0] * 60,
            "purchase_log": [
                {"key": "tango", "time": 5},
                {"key": "battle_fury", "time": 800},
                {"key": "manta", "time": 1400},
            ],
        }]}))

    art = build_hero_builds(details, snapshot=snapshot)
    build = art["heroes"]["1"]
    assert [b["key"] for b in build] == ["battle_fury", "manta"]  # order, no Tango
    assert art["source_matches"] == 5
