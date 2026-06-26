"""Tests for the narrative beats: named fight casualties and Roshan."""

from __future__ import annotations

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import (
    _ROSHAN_FIRST_SECONDS,
    _ROSHAN_RESPAWN_SECONDS,
    simulate,
)

HEROES = {
    f"h{i}": {
        "id": i,
        "display_name": f"H{i}",
        "roles": ["carry"],
        "attack_type": "melee",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    }
    for i in range(1, 11)
}
SCENARIO = Scenario(
    patch_id="test",
    radiant=["h1", "h2", "h3", "h4", "h5"],
    dire=["h6", "h7", "h8", "h9", "h10"],
)
_NAMES = {h["display_name"] for h in HEROES.values()}


def test_fights_name_who_falls() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=42)
    fights = [e for e in timeline.events if e.type.value == "fight"]
    assert fights, "expected at least one teamfight in a full game"

    for fight in fights:
        # Every fight names casualties, the losing side always loses someone, and
        # every named hero is a real participant.
        radiant_dead = fight.payload["radiant_deaths"]
        dire_dead = fight.payload["dire_deaths"]
        losing_dead = dire_dead if fight.payload["winner"] == "radiant" else radiant_dead
        assert losing_dead, "the losing side should take at least one casualty"
        for name in radiant_dead + dire_dead:
            assert name in _NAMES


def test_roshan_falls_to_the_leader_and_respawns() -> None:
    # A dominant Radiant should secure Roshan during the game.
    ratings = {i: 1.6 for i in range(1, 6)} | {i: 0.4 for i in range(6, 11)}
    timeline, _ = simulate(SCENARIO, HEROES, seed=1, ratings=ratings)

    roshans = [e for e in timeline.events if e.type.value == "roshan"]
    assert roshans, "the dominant team should take Roshan at least once"
    assert all(e.payload["team"] == "radiant" for e in roshans)
    # Roshan is never contested before it first spawns.
    assert all(e.t >= _ROSHAN_FIRST_SECONDS for e in roshans)
    # Consecutive kills respect the respawn window.
    times = [e.t for e in roshans]
    for earlier, later in zip(times, times[1:]):
        assert later - earlier >= _ROSHAN_RESPAWN_SECONDS


def test_no_roshan_before_it_spawns() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=7)
    early = [
        e
        for e in timeline.events
        if e.type.value == "roshan" and e.t < _ROSHAN_FIRST_SECONDS
    ]
    assert early == []
