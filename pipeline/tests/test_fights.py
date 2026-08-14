"""Tests for the analytic fight resolver."""

from __future__ import annotations

import pytest

from dm_pipeline.prototype.fight_v0 import radiant_win_probability, resolve_fight
from dm_pipeline.prototype.rng import SeededRng


def test_even_net_worth_is_a_coin_flip() -> None:
    assert radiant_win_probability(20_000, 20_000) == 0.5


def test_leader_is_favored_and_probabilities_are_symmetric() -> None:
    ahead = radiant_win_probability(30_000, 20_000)
    behind = radiant_win_probability(20_000, 30_000)
    assert ahead > 0.5 > behind
    assert ahead + behind == pytest.approx(1.0)


def test_strength_edge_favors_the_stronger_draft() -> None:
    even = radiant_win_probability(20_000, 20_000)
    radiant_stronger = radiant_win_probability(20_000, 20_000, strength_edge=8_000)
    dire_stronger = radiant_win_probability(20_000, 20_000, strength_edge=-8_000)
    assert dire_stronger < even == 0.5 < radiant_stronger


def test_huge_lead_essentially_guarantees_the_win() -> None:
    outcome = resolve_fight(200_000, 0, SeededRng(123))
    assert outcome.winner == "radiant"
    assert outcome.radiant_win_prob > 0.99


def test_favored_team_wins_the_majority_over_many_fights() -> None:
    # ~90% expected for a 10k lead on a 50k map; clear majority across seeds.
    wins = sum(
        1
        for seed in range(200)
        if resolve_fight(30_000, 20_000, SeededRng(seed)).winner == "radiant"
    )
    assert wins > 120


def test_same_lead_is_a_bigger_favorite_early_than_late() -> None:
    # The scale is affine in total map net worth: 10k up on a 50k-gold map
    # (early-mid game) is a far bigger fight edge than 10k up on a 250k map.
    early = radiant_win_probability(30_000, 20_000)
    late = radiant_win_probability(130_000, 120_000)
    assert early > late > 0.5


def test_probabilities_stay_symmetric_when_totals_differ_by_side() -> None:
    # The scale reads the (side-symmetric) total, never who holds the gold.
    ahead = radiant_win_probability(90_000, 60_000)
    behind = radiant_win_probability(60_000, 90_000)
    assert ahead + behind == pytest.approx(1.0)


def test_scale_constants_pin_the_calibrated_fit() -> None:
    # 10k lead at 50k total: scale = 1,475 + 0.0638 * 50,000 = 4,665 gold,
    # sigmoid(10,000 / 4,665) ≈ 0.895. Guards the fitted constants — they were
    # calibrated against 11,212 real teamfights; retune deliberately or not at all.
    assert radiant_win_probability(30_000, 20_000) == pytest.approx(0.8951, abs=1e-3)
