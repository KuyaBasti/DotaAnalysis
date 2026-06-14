"""Determinism (golden-replay) tests for the prototype sim.

The single most important property of the engine: same seed in => byte-identical
timeline out. If this ever breaks, replays stop being reproducible. This is the
miniature of the Rust engine's CI determinism gate.
"""

from __future__ import annotations

import json

from dm_pipeline.prototype.sim_loop import MAX_TIME, simulate


def _timeline_json(seed: int) -> str:
    timeline, _ = simulate(seed)
    return json.dumps(timeline.to_list(), sort_keys=True)


def test_same_seed_is_byte_identical() -> None:
    assert _timeline_json(42) == _timeline_json(42)


def test_different_seeds_diverge() -> None:
    assert _timeline_json(42) != _timeline_json(43)


def test_game_terminates_with_a_winner() -> None:
    timeline, state = simulate(7)

    assert state.game_over
    assert state.winner in {"radiant", "dire"}
    assert 0 < state.t <= MAX_TIME
    assert timeline.events[0].type.value == "game_start"
    assert timeline.events[-1].type.value == "game_over"


def test_winner_is_consistent_with_final_networth() -> None:
    # A decisive win means the winner actually leads in net worth at the end.
    _, state = simulate(99)
    if state.winner == "radiant":
        assert state.radiant.net_worth >= state.dire.net_worth
    else:
        assert state.dire.net_worth >= state.radiant.net_worth
