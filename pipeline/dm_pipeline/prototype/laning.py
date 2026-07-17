"""Laning-phase model v0 (prototype, uncalibrated).

The first ~10 minutes are the most pattern-rich phase, so the early economy is
shaped by a simple lane-matchup score from hero stats: durable, ranged heroes
last-hit and harass more safely. The team with the stronger lanes accrues an
early net-worth edge, which the fight resolver then snowballs.

Real laning is pairwise per lane with player-skill variance and ability matchups
(harass cost, kill threat at 2/3/6, sustain); this is the flattened, fully
deterministic v0 of that.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

LANING_END_SECONDS = 10 * 60  # laning phase lasts ~10 minutes
_RANGED_LANE_BONUS = 8.0  # ranged heroes harass / last-hit more safely
_LANE_GOLD_PER_TICK = 385.0  # total laning gold split between the teams each tick


def hero_lane_strength(hero: dict[str, Any]) -> float:
    """A rough lane-strength score from a hero's base stats and attack type."""
    base = hero.get("base_stats", {})
    stat_total = base.get("str", 0) + base.get("agi", 0) + base.get("int", 0)
    ranged = _RANGED_LANE_BONUS if hero.get("attack_type") == "ranged" else 0.0
    return float(stat_total) + ranged


def team_lane_power(heroes: Iterable[dict[str, Any]]) -> float:
    return sum(hero_lane_strength(hero) for hero in heroes)


def laning_gold_split(
    radiant_power: float, dire_power: float
) -> tuple[float, float]:
    """Split the per-tick laning gold pool by lane-power share."""
    total = radiant_power + dire_power
    if total <= 0:
        return (0.0, 0.0)
    radiant_share = radiant_power / total
    return (
        _LANE_GOLD_PER_TICK * radiant_share,
        _LANE_GOLD_PER_TICK * (1.0 - radiant_share),
    )
