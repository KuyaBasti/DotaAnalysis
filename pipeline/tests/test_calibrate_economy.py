"""Tests for the economy-realism calibration metric."""

from __future__ import annotations

import json

from dm_pipeline.calibrate.economy import (
    economy_comparison,
    real_team_networth,
    timeline_team_networth,
)
from dm_pipeline.prototype.events import Event, EventType
from dm_pipeline.prototype.timeline import Timeline


def _timeline_with_economy(points: dict[int, tuple[float, float]]) -> Timeline:
    tl = Timeline()
    for t, (radiant, dire) in sorted(points.items()):
        tl.emit(
            Event(
                t=t,
                type=EventType.ECONOMY,
                payload={"radiant_net_worth": radiant, "dire_net_worth": dire},
            )
        )
    return tl


def _write_parsed_match(directory, match_id: int, per_minute: list[int]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    players = [
        {"player_slot": slot, "gold_t": per_minute}
        for slot in (0, 1, 2, 3, 4, 128, 129, 130, 131, 132)
    ]
    (directory / f"{match_id}.json").write_text(json.dumps({"players": players}))


def test_timeline_team_networth_reads_the_checkpoint_tick() -> None:
    tl = _timeline_with_economy({600: (10_000, 14_000), 1200: (30_000, 34_000)})
    assert timeline_team_networth(tl, 10) == 12_000.0
    assert timeline_team_networth(tl, 20) == 32_000.0
    assert timeline_team_networth(tl, 30) is None  # game too short


def test_real_team_networth_averages_parsed_matches(tmp_path) -> None:
    # Every player has 1000 gold at minute 10 and 3000 at minute 20.
    gold_t = [0] * 10 + [1000] * 10 + [3000] * 5
    _write_parsed_match(tmp_path, 1, gold_t)

    real = real_team_networth(tmp_path)
    assert real[10] == 5_000.0  # five players x 1000
    assert real[20] == 15_000.0


def test_real_team_networth_empty_without_parsed_data(tmp_path) -> None:
    assert real_team_networth(tmp_path) == {}


def test_economy_comparison_reports_ratios(tmp_path) -> None:
    gold_t = [0] * 10 + [1000] * 10 + [3000] * 5
    _write_parsed_match(tmp_path, 1, gold_t)
    records = [
        {"sim_networth_at": {10: 6_000.0, 20: 15_000.0}},
        {"sim_networth_at": {10: 4_000.0, 20: None}},
    ]

    result = economy_comparison(records, tmp_path)
    assert result["10"] == {"sim": 5_000.0, "real": 5_000.0, "ratio": 1.0}
    assert result["20"]["sim"] == 15_000.0
