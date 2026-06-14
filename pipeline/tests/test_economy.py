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
    carry = hero_gold_gain(SeededRng(1), farm_priority(["carry"]))
    support = hero_gold_gain(SeededRng(1), farm_priority(["support"]))
    assert carry > support
