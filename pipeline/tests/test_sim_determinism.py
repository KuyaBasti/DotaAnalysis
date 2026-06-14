"""Determinism (golden-replay) tests for the prototype sim.

The single most important property of the engine: same scenario + same seed in
=> byte-identical timeline out. If this ever breaks, replays stop being
reproducible. This is the miniature of the Rust engine's CI determinism gate.

Uses an inline hero dict so the tests stay offline (no snapshot file needed).
"""

from __future__ import annotations

import json

import pytest

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import MAX_TIME, simulate

HEROES = {
    "carry_a": {"display_name": "Carry A", "roles": ["carry"]},
    "carry_b": {"display_name": "Carry B", "roles": ["carry"]},
    "supp_a": {"display_name": "Supp A", "roles": ["support"]},
    "supp_b": {"display_name": "Supp B", "roles": ["support"]},
    "mid_a": {"display_name": "Mid A", "roles": ["nuker"]},
    "mid_b": {"display_name": "Mid B", "roles": ["nuker"]},
}
SCENARIO = Scenario(
    patch_id="test",
    radiant=["carry_a", "supp_a", "mid_a"],
    dire=["carry_b", "supp_b", "mid_b"],
)


def _timeline_json(seed: int) -> str:
    timeline, _ = simulate(SCENARIO, HEROES, seed=seed)
    return json.dumps(timeline.to_list(), sort_keys=True)


def test_same_seed_is_byte_identical() -> None:
    assert _timeline_json(42) == _timeline_json(42)


def test_different_seeds_diverge() -> None:
    assert _timeline_json(42) != _timeline_json(43)


def test_game_terminates_with_a_winner() -> None:
    timeline, state = simulate(SCENARIO, HEROES, seed=7)

    assert state.game_over
    assert state.winner in {"radiant", "dire"}
    assert 0 < state.t <= MAX_TIME
    assert timeline.events[0].type.value == "game_start"
    assert timeline.events[-1].type.value == "game_over"


def test_winner_is_consistent_with_final_networth() -> None:
    _, state = simulate(SCENARIO, HEROES, seed=99)
    if state.winner == "radiant":
        assert state.radiant.net_worth >= state.dire.net_worth
    else:
        assert state.dire.net_worth >= state.radiant.net_worth


def test_unknown_hero_key_raises() -> None:
    bad = Scenario(patch_id="test", radiant=["nope"], dire=["carry_b"])
    with pytest.raises(ValueError):
        simulate(bad, HEROES, seed=1)
