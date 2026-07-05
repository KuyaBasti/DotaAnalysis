"""Tests for comeback gold (rubber-band fight bounties)."""

from __future__ import annotations

from dm_pipeline.prototype.fight_v0 import _FIGHT_SWING, resolve_fight
from dm_pipeline.prototype.rng import SeededRng


def _outcome_where(winner: str, radiant_nw: float, dire_nw: float, start_seed: int = 0):
    """Resolve fights over seeds until the requested side wins (deterministic)."""
    for seed in range(start_seed, start_seed + 200):
        outcome = resolve_fight(radiant_nw, dire_nw, SeededRng(seed))
        if outcome.winner == winner:
            return outcome
    raise AssertionError(f"no seed in range made {winner} win")


def test_trailing_winner_gets_scaled_bounty() -> None:
    # Radiant is 20k behind => a radiant fight win pays out double.
    outcome = _outcome_where("radiant", radiant_nw=10_000, dire_nw=30_000)
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
    small = _outcome_where("radiant", radiant_nw=20_000, dire_nw=25_000)
    large = _outcome_where("radiant", radiant_nw=5_000, dire_nw=25_000)
    assert 1.0 < small.comeback_factor < large.comeback_factor <= 2.0
