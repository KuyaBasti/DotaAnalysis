"""Tests for the role-based economy model."""

from __future__ import annotations

from dm_pipeline.prototype.economy import farm_priority, hero_gold_gain
from dm_pipeline.prototype.rng import SeededRng


def test_farm_priority_by_role() -> None:
    assert farm_priority(["Carry", "Escape"]) == 1.0
    assert farm_priority(["Support", "Disabler"]) == 0.45
    assert farm_priority(["Nuker"]) == 0.7


def test_carry_outprioritizes_support() -> None:
    assert farm_priority(["carry"]) > farm_priority(["support"])


def test_higher_priority_earns_more_for_the_same_draw() -> None:
    # Same seed => same base uniform draw, so the higher multiplier must win.
    carry = hero_gold_gain(SeededRng(1), farm_priority(["carry"]), minutes=10)
    support = hero_gold_gain(SeededRng(1), farm_priority(["support"]), minutes=10)
    assert carry > support


def test_income_ramps_with_game_time() -> None:
    # Real farm income grows as items come online; the lane pool owns minute 0.
    early = hero_gold_gain(SeededRng(1), 1.0, minutes=5)
    late = hero_gold_gain(SeededRng(1), 1.0, minutes=25)
    assert hero_gold_gain(SeededRng(1), 1.0, minutes=0) == 0.0
    assert late > early * 4  # linear ramp: 25/5 = 5x


def test_strength_scales_gold() -> None:
    import pytest

    base = hero_gold_gain(SeededRng(1), 1.0, 1.0)
    strong = hero_gold_gain(SeededRng(1), 1.0, 1.5)
    assert strong == pytest.approx(base * 1.5)
