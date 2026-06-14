"""Tests for the laning-phase model."""

from __future__ import annotations

import pytest

from dm_pipeline.prototype.laning import (
    hero_lane_strength,
    laning_gold_split,
    team_lane_power,
)

_MELEE = {"attack_type": "melee", "base_stats": {"str": 20, "agi": 20, "int": 20}}
_RANGED = {"attack_type": "ranged", "base_stats": {"str": 20, "agi": 20, "int": 20}}


def test_lane_strength_counts_total_stats() -> None:
    assert hero_lane_strength(_MELEE) == 60.0  # 20 + 20 + 20, no ranged bonus


def test_ranged_lanes_stronger_than_melee_for_equal_stats() -> None:
    assert hero_lane_strength(_RANGED) > hero_lane_strength(_MELEE)


def test_team_lane_power_sums_heroes() -> None:
    assert team_lane_power([_MELEE, _RANGED]) == (
        hero_lane_strength(_MELEE) + hero_lane_strength(_RANGED)
    )


def test_equal_power_splits_the_pool_evenly() -> None:
    radiant, dire = laning_gold_split(100.0, 100.0)
    assert radiant == dire
    assert radiant + dire == pytest.approx(220.0)


def test_stronger_lane_gets_more_gold() -> None:
    radiant, dire = laning_gold_split(150.0, 50.0)
    assert radiant > dire
    assert radiant + dire == pytest.approx(220.0)


def test_zero_power_yields_no_bonus() -> None:
    assert laning_gold_split(0.0, 0.0) == (0.0, 0.0)
