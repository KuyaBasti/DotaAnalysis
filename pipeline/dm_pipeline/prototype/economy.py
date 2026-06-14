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
_GOLD_PER_TICK_HERO = (60.0, 120.0)

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


def hero_gold_gain(rng: SeededRng, priority: float) -> float:
    """Gold a single hero earns this tick, scaled by its farm priority."""
    return rng.uniform(*_GOLD_PER_TICK_HERO) * priority
