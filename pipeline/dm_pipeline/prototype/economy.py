"""Per-hero economy model (prototype, uncalibrated).

First step of connecting the sim to real patch data: gold income now varies by
hero *role* (carries farm more than supports), derived from the snapshot's role
tags. The numbers are still placeholders pending calibration against real GPM
curves — what matters here is that the lineup now shapes the economy.
"""

from __future__ import annotations

from collections.abc import Iterable

from dm_pipeline.prototype.rng import SeededRng

# Per-hero gold earned in one macro tick, before the role multiplier.
# Calibrated against parsed Divine games (data/details): real farm income
# grows ~linearly with game time (real min 10->20 team gold triples the
# 0->10 increment), so the ramp is proportional to minutes and the laning
# pool carries the early game. Base = the rate at minute 20.
_GOLD_PER_TICK_HERO = (168.0, 336.0)
_RAMP_PER_MIN = 0.05  # ramp = minutes/20: half rate at min 10, 1.5x at min 30

# Role -> farm-priority multiplier (position 1 carry farms most, hard support
# least). Rough placeholders, not calibrated.
_CARRY_PRIORITY = 1.0
_SUPPORT_PRIORITY = 0.45
_DEFAULT_PRIORITY = 0.7


def farm_priority(roles: Iterable[str]) -> float:
    """Map a hero's role tags to a farm-priority multiplier."""
    role_set = {r.lower() for r in roles}
    if "carry" in role_set:
        return _CARRY_PRIORITY
    if "support" in role_set:
        return _SUPPORT_PRIORITY
    return _DEFAULT_PRIORITY


def hero_gold_gain(
    rng: SeededRng, priority: float, strength: float = 1.0, minutes: float = 0.0
) -> float:
    """Gold a single hero earns this tick, scaled by farm priority and strength.

    ``strength`` is a data-derived multiplier (~1.0): stronger heroes (higher
    real win rate) farm more, so a stronger draft out-economies a weaker one.
    ``minutes`` ramps income up over game time the way items do in real games.
    """
    ramp = _RAMP_PER_MIN * minutes
    return rng.uniform(*_GOLD_PER_TICK_HERO) * priority * strength * ramp
