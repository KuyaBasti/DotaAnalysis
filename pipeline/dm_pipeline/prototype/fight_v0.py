"""Analytic fight resolver v0 (prototype, uncalibrated).

Replaces the coin-flip: the team ahead in net worth is more likely to win a
teamfight, via a logistic on the net-worth gap. Win probability snowballs leads
the way real games do, and it's fully explainable (we emit the probability).

This is the seam where a trained ML fight-outcome model plugs in later — same
inputs (game-state features), same output (a win probability + swing), so the
sim loop won't care which resolver it's talking to.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from dm_pipeline.prototype.rng import SeededRng

# Net-worth gap (gold) at which the leader becomes a ~73% fight favorite.
_PROB_SCALE = 10_000.0
# Net-worth swing awarded to the fight's winner (uncalibrated placeholder).
_FIGHT_SWING = (1500.0, 5000.0)


@dataclass
class FightOutcome:
    winner: str  # "radiant" | "dire"
    swing: float  # net-worth swing to the winner
    radiant_win_prob: float


def radiant_win_probability(
    radiant_net_worth: float, dire_net_worth: float
) -> float:
    """Logistic on the net-worth gap; even net worth => 0.5."""
    diff = radiant_net_worth - dire_net_worth
    return 1.0 / (1.0 + math.exp(-diff / _PROB_SCALE))


def resolve_fight(
    radiant_net_worth: float, dire_net_worth: float, rng: SeededRng
) -> FightOutcome:
    """Sample a teamfight outcome from the current net-worth state."""
    p = radiant_win_probability(radiant_net_worth, dire_net_worth)
    winner = "radiant" if rng.chance(p) else "dire"
    swing = rng.uniform(*_FIGHT_SWING)
    return FightOutcome(winner=winner, swing=swing, radiant_win_prob=p)
