"""Tests for the economy-realism calibration metric."""

from __future__ import annotations

import json

from dm_pipeline.calibrate.economy import (
    economy_comparison,
    lead_spread_comparison,
    real_abs_leads,
    real_team_networth,
    timeline_team_lead,
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


def _write_lopsided_match(directory, match_id: int, radiant_per_min: int, dire_per_min: int) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    players = [
        {"player_slot": slot, "gold_t": [m * (radiant_per_min if slot < 128 else dire_per_min) for m in range(25)]}
        for slot in (0, 1, 2, 3, 4, 128, 129, 130, 131, 132)
    ]
    (directory / f"{match_id}.json").write_text(json.dumps({"players": players}))


def test_timeline_team_lead_is_radiant_minus_dire_at_the_tick() -> None:
    tl = _timeline_with_economy({600: (10_000, 14_000), 900: (20_000, 17_000)})
    assert timeline_team_lead(tl, 10) == -4_000.0
    assert timeline_team_lead(tl, 15) == 3_000.0
    assert timeline_team_lead(tl, 20) is None


def test_real_abs_leads_are_unsigned_team_gold_gaps(tmp_path) -> None:
    _write_lopsided_match(tmp_path, 1, radiant_per_min=500, dire_per_min=400)  # Radiant +500/min as a team
    _write_lopsided_match(tmp_path, 2, radiant_per_min=400, dire_per_min=600)  # Dire +1,000/min
    leads = real_abs_leads(tmp_path)
    assert sorted(leads[10]) == [5_000, 10_000]
    assert sorted(leads[20]) == [10_000, 20_000]


def test_lead_spread_compares_medians_of_individual_games(tmp_path) -> None:
    _write_lopsided_match(tmp_path, 1, radiant_per_min=500, dire_per_min=400)
    _write_lopsided_match(tmp_path, 2, radiant_per_min=400, dire_per_min=600)
    records = [
        {"sim_lead_at": {10: [-30_000.0, 10_000.0], 15: [12_000.0]}},
        {"sim_lead_at": {10: [20_000.0], 15: []}},
    ]
    result = lead_spread_comparison(records, tmp_path)
    assert result["10"]["sim_median"] == 20_000.0  # |−30k|, 10k, 20k — signs dropped, games not averaged
    assert result["10"]["real_median"] == 7_500.0
    assert result["10"]["ratio"] == 2.67
    assert result["15"]["sim_median"] == 12_000.0
    assert "20" not in result  # no sim reached minute 20


def test_lead_spread_is_absent_without_real_data(tmp_path) -> None:
    assert lead_spread_comparison([{"sim_lead_at": {10: [1.0]}}], tmp_path) is None


def test_a_match_with_a_missing_slot_is_skipped_not_summed_six_against_four(tmp_path) -> None:
    _write_lopsided_match(tmp_path, 1, radiant_per_min=500, dire_per_min=500)  # dead even
    bad = json.loads((tmp_path / "1.json").read_text())
    del bad["players"][7]["player_slot"]
    (tmp_path / "1.json").write_text(json.dumps(bad))
    assert real_abs_leads(tmp_path) == {}
