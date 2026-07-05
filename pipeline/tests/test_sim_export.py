"""Tests for the sim-result export shape (what the API serves)."""

from __future__ import annotations

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import sim_result, simulate

HEROES = {
    "carry_a": {"display_name": "Carry A", "roles": ["carry"], "attack_type": "melee", "base_stats": {"str": 22, "agi": 20, "int": 16}},
    "carry_b": {"display_name": "Carry B", "roles": ["carry"], "attack_type": "ranged", "base_stats": {"str": 18, "agi": 24, "int": 18}},
}
SCENARIO = Scenario(patch_id="7.39c", radiant=["carry_a"], dire=["carry_b"])


def test_sim_result_has_expected_shape() -> None:
    timeline, state = simulate(SCENARIO, HEROES, seed=3)
    result = sim_result(SCENARIO, timeline, state, seed=3)

    assert result["id"] == "7.39c-seed3"
    assert result["seed"] == 3
    assert result["summary"]["winner"] in {"radiant", "dire"}
    assert result["summary"]["duration_seconds"] > 0
    assert result["timeline"][0]["type"] == "game_start"
    assert result["timeline"][-1]["type"] == "game_over"


def test_economy_events_carry_running_net_worth() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=3)
    economy = next(e for e in timeline.to_list() if e["type"] == "economy")
    assert "radiant_net_worth" in economy["payload"]
    assert "dire_net_worth" in economy["payload"]
    assert economy["payload"]["radiant_net_worth"] >= 0


def test_economy_events_carry_per_hero_networths() -> None:
    from dm_pipeline.prototype.scenario import Scenario
    from dm_pipeline.prototype.sim_loop import simulate

    heroes = {
        f"h{i}": {
            "id": i,
            "display_name": f"H{i}",
            "roles": ["carry"],
            "attack_type": "melee",
            "base_stats": {"str": 20, "agi": 20, "int": 20},
        }
        for i in range(1, 5)
    }
    scenario = Scenario(patch_id="test", radiant=["h1", "h2"], dire=["h3", "h4"])
    timeline, _ = simulate(scenario, heroes, seed=5)

    economy = next(e for e in timeline.events if e.type.value == "economy")
    radiant = economy.payload["radiant_heroes"]
    assert [h["hero"] for h in radiant] == ["H1", "H2"]
    team_total = economy.payload["radiant_net_worth"]
    assert abs(sum(h["net_worth"] for h in radiant) - team_total) < 1.0
