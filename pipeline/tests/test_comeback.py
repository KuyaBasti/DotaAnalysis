"""Tests for comeback gold (rubber-band fight bounties)."""

from __future__ import annotations

from dm_pipeline.prototype.fight_v0 import (
    _COMEBACK_DEFICIT_FULL,
    _FIGHT_SWING,
    resolve_fight,
)
from dm_pipeline.prototype.rng import SeededRng


def _outcome_where(winner: str, radiant_nw: float, dire_nw: float, start_seed: int = 0):
    """Resolve fights over seeds until the requested side wins (deterministic)."""
    for seed in range(start_seed, start_seed + 200):
        outcome = resolve_fight(radiant_nw, dire_nw, SeededRng(seed))
        if outcome.winner == winner:
            return outcome
    raise AssertionError(f"no seed in range made {winner} win")


def test_trailing_winner_gets_scaled_bounty() -> None:
    # Radiant is 20k behind => a radiant fight win pays out double. Mid-game
    # totals: on a small map a 20k deficit is a ~0.3% fight underdog under the
    # calibrated scale, and the fixed-seed search would (rightly) never see one.
    # Mid-game totals: at the old 5k/25k fixture a 20k deficit is a ~0.3%
    # fight underdog under the calibrated scale — the fixed-seed search still
    # finds a win (seed 139), but only by a 1-in-370 fluke the test shouldn't
    # lean on. At 100k total the searched event is ~7%: robust. start_seed
    # picks a window whose first radiant win rolled a high base swing, so the
    # doubled payout provably exceeds the normal cap.
    outcome = _outcome_where(
        "radiant",
        radiant_nw=40_000,
        dire_nw=40_000 + _COMEBACK_DEFICIT_FULL,
        start_seed=32,
    )
    assert outcome.comeback_factor == 2.0
    assert outcome.swing > _FIGHT_SWING[1]  # beyond the normal max swing


def test_leading_winner_gets_no_bonus() -> None:
    outcome = _outcome_where("radiant", radiant_nw=30_000, dire_nw=10_000)
    assert outcome.comeback_factor == 1.0
    assert _FIGHT_SWING[0] <= outcome.swing <= _FIGHT_SWING[1]


def test_even_game_has_no_bonus() -> None:
    outcome = _outcome_where("dire", radiant_nw=15_000, dire_nw=15_000)
    assert outcome.comeback_factor == 1.0


def test_bonus_scales_with_deficit() -> None:
    small = _outcome_where("radiant", radiant_nw=40_000, dire_nw=45_000)
    large = _outcome_where("radiant", radiant_nw=40_000, dire_nw=60_000)
    assert 1.0 < small.comeback_factor < large.comeback_factor <= 2.0
