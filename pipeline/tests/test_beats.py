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


def _roshan_kills(seeds: range) -> list[tuple[int, str, float, list[int]]]:
    """(seed, taker, Radiant's gold lead at the tick before, all kill times) per kill."""
    out = []
    for seed in seeds:
        timeline, _ = simulate(SCENARIO, HEROES, seed=seed)
        lead_at = {}
        for e in timeline.events:
            if e.type.value == "economy":
                lead_at[e.t] = e.payload["radiant_net_worth"] - e.payload["dire_net_worth"]
        times = [e.t for e in timeline.events if e.type.value == "roshan"]
        for e in timeline.events:
            if e.type.value == "roshan":
                out.append((seed, e.payload["team"], lead_at[e.t], times))
    return out


def test_roshan_usually_falls_to_the_gold_leader_and_respects_respawn() -> None:
    kills = _roshan_kills(range(300))
    assert len(kills) > 100
    by_leader = sum(1 for _, team, lead, _ in kills if (team == "radiant") == (lead > 0))
    # Real ranked games: the gold leader takes 87.6% of Roshans. (The lead is
    # read from the tick's economy event, after this tick's income — a hair
    # different from the engine's own pre-Roshan read, hence the band.)
    assert 0.80 <= by_leader / len(kills) <= 0.95
    for _, _, _, times in kills:
        assert all(t >= _ROSHAN_FIRST_SECONDS for t in times)
        for earlier, later in zip(times, times[1:]):
            assert later - earlier >= _ROSHAN_RESPAWN_SECONDS


def test_roshan_is_a_late_mid_game_objective_like_in_real_games() -> None:
    # Real ranked: first Roshan at a median of 26.8 min, in 61% of games. The
    # old engine took it at a median of 12 min in nearly every game.
    firsts, games = [], 300
    for seed in range(games):
        timeline, _ = simulate(SCENARIO, HEROES, seed=seed)
        ks = [e.t for e in timeline.events if e.type.value == "roshan"]
        if ks:
            firsts.append(ks[0])
    firsts.sort()
    assert 23 * 60 <= firsts[len(firsts) // 2] <= 32 * 60
    assert 0.3 <= len(firsts) / games <= 0.9


def test_no_roshan_before_it_spawns() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=7)
    early = [
        e
        for e in timeline.events
        if e.type.value == "roshan" and e.t < _ROSHAN_FIRST_SECONDS
    ]
    assert early == []
