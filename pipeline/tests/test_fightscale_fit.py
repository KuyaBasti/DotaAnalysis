"""Tests for the fight-scale fit tool (calibrate/fightscale.py).

The extraction rules were pinned by the original fit's adversarial review:
pre-fight features only, deaths-based labels, ties dropped, split by match.
These tests keep a future edit from quietly loosening any of them.
"""

from __future__ import annotations

import json
import math
import random

import numpy as np
import pytest

from dm_pipeline.calibrate.fightscale import (
    FightObservation,
    extract_fights,
    fit,
    is_test,
)


def _player(slot: int, gold_t: list[int]) -> dict:
    return {"player_slot": slot, "gold_t": gold_t}


def _detail(
    match_id: int,
    teamfights: list[dict],
    gold_by_minute: list[int] | None = None,
    n_players: int = 10,
) -> dict:
    """A minimal parsed-match dict. Radiant slots 0-4, dire slots 128-132."""
    gold = gold_by_minute if gold_by_minute is not None else [0, 100, 200, 300, 400]
    slots = [0, 1, 2, 3, 4, 128, 129, 130, 131, 132][:n_players]
    return {
        "match_id": match_id,
        "players": [_player(s, list(gold)) for s in slots],
        "teamfights": teamfights,
    }


def _teamfight(start: int, radiant_deaths: int, dire_deaths: int) -> dict:
    deaths = [radiant_deaths, 0, 0, 0, 0, dire_deaths, 0, 0, 0, 0]
    return {"start": start, "players": [{"deaths": d} for d in deaths]}


def _write(tmp_path, details: list[dict]) -> str:
    for detail in details:
        path = tmp_path / f"{detail['match_id']}.json"
        path.write_text(json.dumps(detail))
    return str(tmp_path)


def test_features_come_from_the_minute_before_the_fight(tmp_path) -> None:
    # Fight starts at 155s -> floor gives minute 2 -> gold_t[2]. The start is
    # chosen so round(155/60) = 3 would read gold_t[3] — the 180s snapshot,
    # AFTER the fight begins — so a floor->round mutation fails here.
    d = _detail(1, [_teamfight(start=155, radiant_deaths=0, dire_deaths=2)])
    rows = extract_fights(_write(tmp_path, [d]))
    assert len(rows) == 1
    assert rows[0].total == 200 * 10  # gold_t[2] for all ten players
    assert rows[0].nw_diff == 0.0


def test_nw_diff_is_radiant_minus_dire(tmp_path) -> None:
    # Asymmetric gold pins the sign convention: radiant slots richer.
    radiant_gold = [0, 300, 600]
    dire_gold = [0, 100, 200]
    detail = {
        "match_id": 1,
        "players": [_player(s, list(radiant_gold)) for s in (0, 1, 2, 3, 4)]
        + [_player(s, list(dire_gold)) for s in (128, 129, 130, 131, 132)],
        "teamfights": [_teamfight(start=125, radiant_deaths=0, dire_deaths=2)],
    }
    rows = extract_fights(_write(tmp_path, [detail]))
    assert rows[0].nw_diff == 600 * 5 - 200 * 5  # +2,000: radiant ahead
    assert rows[0].total == 600 * 5 + 200 * 5
    assert rows[0].radiant_won is True


def test_tied_fights_are_dropped(tmp_path) -> None:
    d = _detail(1, [_teamfight(start=60, radiant_deaths=2, dire_deaths=2)])
    assert extract_fights(_write(tmp_path, [d])) == []


def test_fewer_deaths_wins(tmp_path) -> None:
    d = _detail(
        1,
        [
            _teamfight(start=60, radiant_deaths=1, dire_deaths=3),
            _teamfight(start=120, radiant_deaths=4, dire_deaths=2),
        ],
    )
    rows = extract_fights(_write(tmp_path, [d]))
    assert [r.radiant_won for r in rows] == [True, False]


def test_malformed_matches_are_skipped_not_fatal(tmp_path) -> None:
    nine_players = _detail(1, [_teamfight(60, 0, 2)], n_players=9)
    short_gold = _detail(
        2, [_teamfight(start=600, radiant_deaths=0, dire_deaths=2)]
    )  # minute 10 > len(gold_t): unindexable -> skipped
    bad_fight_players = _detail(3, [{"start": 60, "players": [{"deaths": 1}]}])
    good = _detail(4, [_teamfight(start=60, radiant_deaths=0, dire_deaths=2)])
    rows = extract_fights(
        _write(tmp_path, [nine_players, short_gold, bad_fight_players, good])
    )
    assert [r.match_id for r in rows] == [4]


def test_unparsed_ledger_is_ignored(tmp_path) -> None:
    (tmp_path / "_unparsed.json").write_text('{"not": "a match"}')
    d = _detail(1, [_teamfight(start=60, radiant_deaths=0, dire_deaths=2)])
    rows = extract_fights(_write(tmp_path, [d]))
    assert len(rows) == 1


def test_split_is_by_match_and_deterministic() -> None:
    match_id = np.array([5, 5, 5, 7, 7, 10])
    test = is_test(match_id)
    assert test.tolist() == [True, True, True, False, False, True]


def _synthetic_rows(
    base: float, per_total: float, n: int, seed: int = 0
) -> list[FightObservation]:
    """Fights whose labels are drawn from the known affine-scale logistic."""
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        total = rng.uniform(20_000, 200_000)
        nw_diff = rng.uniform(-0.3, 0.3) * total
        p = 1.0 / (1.0 + math.exp(-nw_diff / (base + per_total * total)))
        rows.append(
            FightObservation(
                match_id=i,  # one fight per match keeps the split trivial
                minute=total / 6_000.0,
                nw_diff=nw_diff,
                total=total,
                radiant_won=rng.random() < p,
            )
        )
    return rows


def test_fit_recovers_known_constants() -> None:
    # Truth constants deliberately FAR from the shipped pair (the optimizer's
    # x0): at these totals the x0 scale is 13-54% off the truth, so a fit()
    # that silently returns its starting point fails every assertion below.
    rows = _synthetic_rows(base=3_000.0, per_total=0.03, n=4_000)
    result = fit(rows)
    # The two parameters trade off against each other, so judge the fit where
    # it acts: the implied scale at representative totals.
    for total in (30_000, 100_000, 180_000):
        true_scale = 3_000.0 + 0.03 * total
        fitted_scale = result.base + result.per_total * total
        assert fitted_scale == pytest.approx(true_scale, rel=0.10)
    # With the truth this far from shipped, the fit must beat it held-out.
    assert result.brier_test_fitted < result.brier_test_shipped


def test_degenerate_split_raises() -> None:
    all_test = _synthetic_rows(base=3_000.0, per_total=0.03, n=50)
    for row in all_test:
        row.match_id = 5  # every match lands in the test fold
    with pytest.raises(ValueError, match="degenerate split"):
        fit(all_test)
    all_train = _synthetic_rows(base=3_000.0, per_total=0.03, n=50)
    for row in all_train:
        row.match_id = 1  # every match lands in the train fold
    with pytest.raises(ValueError, match="degenerate split"):
        fit(all_train)


def test_fit_report_scores_shipped_constants_on_the_same_test_set() -> None:
    rows = _synthetic_rows(base=1_500.0, per_total=0.06, n=2_000)
    result = fit(rows)
    assert result.n_train + result.n_test == result.n_fights == 2_000
    assert 0.0 < result.brier_test_shipped < 0.3
    assert sum(n for _, _, n, _, _ in result.buckets) == result.n_test
