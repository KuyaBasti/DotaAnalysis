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


def test_huge_lead_essentially_guarantees_the_win() -> None:
    outcome = resolve_fight(200_000, 0, SeededRng(123))
    assert outcome.winner == "radiant"
    assert outcome.radiant_win_prob > 0.99


def test_favored_team_wins_the_majority_over_many_fights() -> None:
    # ~73% expected for a 10k lead; assert a clear majority across fixed seeds.
    wins = sum(
        1
        for seed in range(200)
        if resolve_fight(30_000, 20_000, SeededRng(seed)).winner == "radiant"
    )
    assert wins > 120
