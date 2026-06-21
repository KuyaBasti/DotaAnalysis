"""Tests for data-derived hero strength affecting the sim economy."""

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


def test_stronger_team_out_economies() -> None:
    # Radiant heroes much stronger than dire => radiant should end far richer.
    ratings = {1: 1.5, 2: 1.5, 3: 0.5, 4: 0.5}
    _, state = simulate(SCENARIO, HEROES, seed=1, ratings=ratings)
    assert state.radiant.net_worth > state.dire.net_worth


def test_neutral_ratings_match_no_ratings() -> None:
    neutral = {1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0}
    _, with_neutral = simulate(SCENARIO, HEROES, seed=1, ratings=neutral)
    _, without = simulate(SCENARIO, HEROES, seed=1)
    assert with_neutral.radiant.net_worth == without.radiant.net_worth
    assert with_neutral.dire.net_worth == without.dire.net_worth
