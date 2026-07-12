"""Tests for the objectives model (towers -> Ancient win condition)."""

from __future__ import annotations

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import simulate

HEROES = {
    f"h{i}": {
        "id": i,
        "display_name": f"H{i}",
        "roles": ["carry"],
        "attack_type": "melee",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    }
    for i in range(1, 5)
}
SCENARIO = Scenario(patch_id="test", radiant=["h1", "h2"], dire=["h3", "h4"])


def test_dominant_team_destroys_the_ancient() -> None:
    # Radiant overwhelmingly stronger => should push the full ladder and win.
    ratings = {1: 1.6, 2: 1.6, 3: 0.4, 4: 0.4}
    timeline, state = simulate(SCENARIO, HEROES, seed=1, ratings=ratings)

    assert state.winner == "radiant"
    assert state.radiant.objectives == 5  # took every structure incl. the Ancient
    objectives = [e for e in timeline.events if e.type.value == "objective"]
    assert objectives[-1].payload["structure"] == "ancient"


def test_game_ends_with_a_winner_and_more_structures() -> None:
    _, state = simulate(SCENARIO, HEROES, seed=7)

    assert state.game_over and state.winner in {"radiant", "dire"}
    winner = state.radiant if state.winner == "radiant" else state.dire
    loser = state.dire if state.winner == "radiant" else state.radiant
    assert winner.objectives >= loser.objectives


def test_no_structures_fall_before_the_objective_phase() -> None:
    # Early in the game, no towers should be down yet.
    timeline, _ = simulate(SCENARIO, HEROES, seed=3)
    early = [
        e
        for e in timeline.events
        if e.type.value == "objective" and e.t < 8 * 60
    ]
    assert early == []


def test_towers_fall_in_a_lane_but_the_ancient_does_not() -> None:
    ratings = {1: 1.6, 2: 1.6, 3: 0.4, 4: 0.4}
    timeline, _ = simulate(SCENARIO, HEROES, seed=1, ratings=ratings)

    objectives = [e for e in timeline.events if e.type.value == "objective"]
    for e in objectives:
        if e.payload["structure"] == "ancient":
            assert "lane" not in e.payload
        else:
            assert e.payload["lane"] in {"top", "mid", "bot"}
