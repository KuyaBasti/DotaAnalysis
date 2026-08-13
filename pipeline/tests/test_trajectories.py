"""Tests for the farm-timing trajectory extraction (`dm-trajectories`).

The two properties that came out of the spike's adversarial review are the
ones pinned hardest: the team-lead channel cannot reach a within-team share,
and no per-hero statistic may be weighted by that hero's win rate.
"""

from __future__ import annotations

import json
from pathlib import Path

from dm_pipeline.features.trajectories import (
    GATE_MIN_SCALING_GAMES,
    MINUTES,
    build_trajectories,
    extract_observations,
    save_trajectories,
)


def _write_game(
    dir: Path,
    name: str,
    *,
    radiant_gold: list[list[int]],
    dire_gold: list[list[int]],
    radiant_ids: list[int],
    dire_ids: list[int],
    radiant_win: bool = True,
    duration: int = 31 * 60,
) -> None:
    players = [
        {"hero_id": hid, "isRadiant": True, "gold_t": g, "player_slot": i}
        for i, (hid, g) in enumerate(zip(radiant_ids, radiant_gold))
    ] + [
        {"hero_id": hid, "isRadiant": False, "gold_t": g, "player_slot": 128 + i}
        for i, (hid, g) in enumerate(zip(dire_ids, dire_gold))
    ]
    (dir / f"{name}.json").write_text(
        json.dumps(
            {"duration": duration, "radiant_win": radiant_win, "players": players}
        )
    )


def _flat(value: int, minutes: int = 31) -> list[int]:
    return [value * (m + 1) for m in range(minutes)]  # linear growth, flat share


def test_team_lead_cannot_reach_the_share(tmp_path) -> None:
    # Dire earns 10x Radiant's gold. If the denominator were the 10-player
    # total (the reviewed-out bug), every Radiant share would crater; within
    # the team, five equal earners are 0.2 each regardless of the blowout.
    _write_game(
        tmp_path,
        "blowout",
        radiant_gold=[_flat(100)] * 5,
        dire_gold=[_flat(1000)] * 5,
        radiant_ids=[1, 2, 3, 4, 5],
        dire_ids=[6, 7, 8, 9, 10],
    )
    heroes, used = extract_observations(tmp_path)
    assert used == 1
    for hid in (1, 6):  # one hero from each side
        stratum = "w" if hid == 1 else "l"
        for m in MINUTES:
            vals = heroes[hid]["share"][m][stratum]
            assert vals and abs(vals[0] - 0.2) < 1e-9


def test_statistics_are_outcome_balanced_never_winrate_weighted(tmp_path) -> None:
    # Hero 1 hogs gold in wins (share 0.4) and starves in losses (share 0.1),
    # and wins 3 of 6 games here. The balanced mean must be (0.4+0.1)/2 = 0.25
    # at every minute — the same as if they won half — not the 0.25-vs-winrate
    # weighted pooled mean it would be under a different win rate.
    for i in range(3):
        _write_game(
            tmp_path, f"win{i}",
            radiant_gold=[_flat(400)] + [_flat(150)] * 4,
            dire_gold=[_flat(200)] * 5,
            radiant_ids=[1, 2, 3, 4, 5], dire_ids=[6, 7, 8, 9, 10],
            radiant_win=True,
        )
        _write_game(
            tmp_path, f"loss{i}",
            radiant_gold=[_flat(100)] + [_flat(225)] * 4,
            dire_gold=[_flat(200)] * 5,
            radiant_ids=[1, 2, 3, 4, 5], dire_ids=[6, 7, 8, 9, 10],
            radiant_win=False,
        )
    art = build_trajectories(tmp_path)
    h1 = art["heroes"]["1"]
    for v in h1["curve"]:
        assert v is not None and abs(v - 0.25) < 1e-6


def test_thin_stratum_reports_null_not_a_biased_number(tmp_path) -> None:
    # Hero 1 appears in wins only — no loss stratum, so every statistic must be
    # null rather than a wins-only (win-rate-weighted) estimate.
    for i in range(4):
        _write_game(
            tmp_path, f"w{i}",
            radiant_gold=[_flat(300)] + [_flat(150)] * 4,
            dire_gold=[_flat(200)] * 5,
            radiant_ids=[1, 2, 3, 4, 5], dire_ids=[6, 7, 8, 9, 10],
            radiant_win=True,
        )
    art = build_trajectories(tmp_path)
    h1 = art["heroes"]["1"]
    assert all(v is None for v in h1["curve"])
    assert h1["scaling"] is None
    assert h1["gated"] is False


def test_short_games_contribute_early_minutes_but_no_scaling(tmp_path) -> None:
    # A 20-minute game has minutes 5..20 but no minute 25, so it feeds the
    # early curve and must NOT produce a scaling observation.
    _write_game(
        tmp_path, "short",
        radiant_gold=[_flat(100, minutes=21)] * 5,
        dire_gold=[_flat(100, minutes=21)] * 5,
        radiant_ids=[1, 2, 3, 4, 5], dire_ids=[6, 7, 8, 9, 10],
        duration=20 * 60,
    )
    heroes, used = extract_observations(tmp_path)
    assert used == 1
    assert heroes[1]["share"][20]["w"]  # early minutes present
    assert not heroes[1]["share"][25]["w"]
    assert not heroes[1]["scaling"]["w"]  # no scaling from a short game


def test_gate_requires_both_volume_and_balanced_strata(tmp_path) -> None:
    # 19 wins + 19 losses = 38 scaling games with both strata: gated. The same
    # volume all-wins (previous test) is not. Encode a scaling hero: rises from
    # 0.2 to 0.3 of team gold by minute 25.
    rising = [int((0.2 + 0.1 * min(m / 25, 1)) * 1000 * (m + 1)) for m in range(31)]
    flat4 = [_flat(200)] * 4
    for i in range(19):
        for won, tag in ((True, "w"), (False, "l")):
            _write_game(
                tmp_path, f"{tag}{i}",
                radiant_gold=[rising] + flat4,
                dire_gold=[_flat(200)] * 5,
                radiant_ids=[1, 2, 3, 4, 5], dire_ids=[6, 7, 8, 9, 10],
                radiant_win=won,
            )
    art = build_trajectories(tmp_path)
    h1 = art["heroes"]["1"]
    assert h1["n_scaling"] == 2 * 19 == GATE_MIN_SCALING_GAMES
    assert h1["gated"] is True
    assert h1["scaling"] is not None and h1["scaling"] > 0  # rising share


def test_artifact_is_self_describing_and_loadable(tmp_path) -> None:
    _write_game(
        tmp_path, "g",
        radiant_gold=[_flat(100)] * 5, dire_gold=[_flat(100)] * 5,
        radiant_ids=[1, 2, 3, 4, 5], dire_ids=[6, 7, 8, 9, 10],
    )
    art = build_trajectories(tmp_path)
    path = save_trajectories(art, out_dir=tmp_path)
    loaded = json.loads(path.read_text())
    assert loaded["minutes"] == list(MINUTES)
    assert loaded["gate_min_scaling_games"] == GATE_MIN_SCALING_GAMES
    # keys are hero ids-as-strings: self-describing, like the pairs artifact
    assert set(loaded["heroes"]) == {str(i) for i in range(1, 11)}
