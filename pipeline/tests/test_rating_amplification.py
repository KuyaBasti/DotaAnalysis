"""How hard a draft's rating edge should swing the result.

Hero strength is paid out twice — stronger heroes farm more (economy), and the
fight resolver adds a strength edge on top. That made the sim wildly
over-confident: a draft real players win ~74% of the time simulated at 98%.

The target here is measured, not intuited. Over 59,410 real ranked matches, a
draft's rating edge (summed hero strength above neutral, radiant minus dire)
maps to the real win rate as::

    P(radiant win) = sigmoid(2.07 * edge)

These tests pin the sim to that curve in the range where real drafts actually
live (|edge| <= ~0.6 covers 99% of them). Bounds are wide enough for
Monte-Carlo noise and for this fixture's role mix, but tight enough that the
old double-counting constant fails them by a mile.
"""

from __future__ import annotations

import math

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import simulate

# Slope of the real edge -> win-rate curve, fit on the ranked corpus.
REAL_LOGIT_SLOPE = 2.07

_ROLES = ("carry", "nuker", "support", "support", "initiator")
HEROES = {
    f"h{i}": {
        "id": i,
        "display_name": f"H{i}",
        "roles": [_ROLES[(i - 1) % 5]],
        "attack_type": "melee",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    }
    for i in range(1, 11)
}
SCENARIO = Scenario(
    patch_id="test",
    radiant=[f"h{i}" for i in range(1, 6)],
    dire=[f"h{i}" for i in range(6, 11)],
)


def _win_rate(edge: float, runs: int = 120) -> float:
    """Radiant win rate when radiant's draft out-rates dire's by ``edge``."""
    per_hero = edge / 10.0  # split across both sides: +per radiant, -per dire
    ratings = {i: 1.0 + per_hero for i in range(1, 6)}
    ratings |= {i: 1.0 - per_hero for i in range(6, 11)}
    wins = sum(
        simulate(SCENARIO, HEROES, seed=seed, ratings=ratings)[1].winner == "radiant"
        for seed in range(runs)
    )
    return wins / runs


def _real_win_rate(edge: float) -> float:
    return 1.0 / (1.0 + math.exp(-REAL_LOGIT_SLOPE * edge))


def test_typical_draft_edge_matches_the_real_curve() -> None:
    # edge 0.25 sits around the 60th percentile of real drafts; real data wins
    # these ~63% of the time. The old constant simulated them at 86%.
    assert abs(_win_rate(0.25) - _real_win_rate(0.25)) < 0.10


def test_strong_draft_edge_matches_the_real_curve() -> None:
    # edge 0.50 is roughly the 95th percentile of real drafts — a genuinely
    # lopsided lineup, which reality still only wins ~74% of the time. The old
    # constant simulated it at 98%: a coin-flip's worth of over-confidence.
    assert abs(_win_rate(0.50) - _real_win_rate(0.50)) < 0.10


def test_an_extreme_draft_is_favored_but_never_certain() -> None:
    # No real draft reaches this edge (the observed max is ~1.3), but the Draft
    # Studio lets you build one. It should read "heavily favored", not
    # "decided" — the old constant returned a flat 100% over 400 runs.
    # Disclosure: under the affine fight scale this test FAILED at its original
    # n=200 (199/200 = 0.995, exactly at the bound; the fixed scale measured
    # 0.975). At n=400 the affine engine measures 396/400 = 0.990 (fixed scale:
    # 0.985; real curve: 0.973) — the true rate satisfies the bound and the
    # n=200 reading was quantization (steps of 0.005), but know that the affine
    # scale did push extreme-draft confidence up, and this bound is the ceiling
    # policing it. The bound itself is unchanged.
    extreme = _win_rate(1.737, runs=400)
    assert 0.85 < extreme < 0.995


def test_win_rate_rises_monotonically_with_the_edge() -> None:
    rates = [_win_rate(e) for e in (0.0, 0.25, 0.5)]
    assert rates == sorted(rates)
    assert rates[0] < 0.60  # an even draft is near a coin flip
