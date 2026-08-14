"""Analytic fight resolver, calibrated against real teamfights.

The team ahead in net worth is more likely to win a teamfight, via a logistic
on the net-worth gap. Win probability snowballs leads the way real games do,
and it's fully explainable (we emit the probability).

This seam was reserved for a trained ML fight-outcome model, and the model was
spiked (2026-08-14) on 11,212 real Divine+ teamfights: a 4-feature learned
logistic scored held-out Brier 0.1981 — and this analytic form with the
affine gold-relative scale below scored 0.1975. The analytic resolver beat
the ML candidate, so no trained artifact plugs in here; the calibration
lives in two constants instead.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from dm_pipeline.prototype.rng import SeededRng

# Fight-outcome scale, affine in total map net worth: fights respond to a
# lead relative to how much gold is in the game, not to its absolute size —
# 2k up at min 8 is a ~67% fight favorite; 12k up at min 35 only ~73%. Fit by
# MLE on 11,212 real Divine+ teamfights (deaths-based labels, features frozen
# at the minute before each fight, split by match): held-out Brier 0.1975 vs
# 0.2051 for the old fixed 10k scale, p < 1e-5 match-clustered. Real fights
# ran ~2.7k (min 0-10) to ~11.7k (min 30+) of implied scale; the affine fit
# wins the early/mid buckets decisively and statistically ties min 30+, where
# the old 10k sits closest to the fitted line (it edges the affine there by an
# insignificant ~0.001 Brier, n=362 — disclosed, not hidden).
_PROB_SCALE_BASE = 1_475.0
_PROB_SCALE_PER_TOTAL = 0.0638
# Net-worth swing awarded to the fight's winner, sized like real bounty
# economics for a skirmish: a pick nets ~0.6k, a won brawl up to ~1.8k.
# Fights fire twice as often as before, so per-minute fight gold is unchanged
# and the economy calibration holds.
_FIGHT_SWING = (600.0, 1_800.0)
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
    Even net worth and even drafts => 0.5. The logistic's scale grows with
    total map net worth, so the same absolute lead is a bigger fight edge
    early than late (symmetry holds: the scale is the same from both sides).
    """
    diff = (radiant_net_worth - dire_net_worth) + strength_edge
    scale = _PROB_SCALE_BASE + _PROB_SCALE_PER_TOTAL * (
        radiant_net_worth + dire_net_worth
    )
    return 1.0 / (1.0 + math.exp(-diff / scale))


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
