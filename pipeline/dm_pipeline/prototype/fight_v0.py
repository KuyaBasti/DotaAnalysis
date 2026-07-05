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
# Comeback gold, like the real game's rubber-band bounties: when the trailing
# team wins a fight, the swing grows with their deficit — up to double at
# _COMEBACK_DEFICIT_FULL behind. Leads stay valuable; claw-backs get teeth.
_COMEBACK_DEFICIT_FULL = 20_000.0
_COMEBACK_MAX_BONUS = 1.0  # +100% swing at a full deficit


@dataclass
class FightOutcome:
    winner: str  # "radiant" | "dire"
    swing: float  # net-worth swing to the winner
    radiant_win_prob: float
    comeback_factor: float = 1.0  # >1 when the trailing team won the fight


def radiant_win_probability(
    radiant_net_worth: float,
    dire_net_worth: float,
    strength_edge: float = 0.0,
) -> float:
    """Logistic on the net-worth gap plus a draft-strength edge.

    ``strength_edge`` is the stronger draft's advantage expressed in net-worth-
    equivalent gold, so a better draft is favored in a fight even at even gold.
    Even net worth and even drafts => 0.5.
    """
    diff = (radiant_net_worth - dire_net_worth) + strength_edge
    return 1.0 / (1.0 + math.exp(-diff / _PROB_SCALE))


def resolve_fight(
    radiant_net_worth: float,
    dire_net_worth: float,
    rng: SeededRng,
    *,
    strength_edge: float = 0.0,
) -> FightOutcome:
    """Sample a teamfight outcome from net-worth state and draft strength.

    Comeback gold: if the winner was behind in net worth, the swing is scaled
    up with the deficit (rubber-banding, like real kill bounties).
    """
    p = radiant_win_probability(radiant_net_worth, dire_net_worth, strength_edge)
    winner = "radiant" if rng.chance(p) else "dire"
    swing = rng.uniform(*_FIGHT_SWING)

    winner_nw, loser_nw = (
        (radiant_net_worth, dire_net_worth)
        if winner == "radiant"
        else (dire_net_worth, radiant_net_worth)
    )
    deficit = max(0.0, loser_nw - winner_nw)
    factor = 1.0 + _COMEBACK_MAX_BONUS * min(1.0, deficit / _COMEBACK_DEFICIT_FULL)
    return FightOutcome(
        winner=winner,
        swing=swing * factor,
        radiant_win_prob=p,
        comeback_factor=factor,
    )
