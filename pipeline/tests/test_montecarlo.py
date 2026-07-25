"""Tests for Monte-Carlo aggregation."""

from __future__ import annotations

import json

from dm_pipeline.prototype.montecarlo import aggregate_scenario, run_and_export
from dm_pipeline.prototype.scenario import Scenario

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


def test_aggregate_shape_and_conservation() -> None:
    aggregate, rep_seed = aggregate_scenario(SCENARIO, HEROES, runs=50, base_seed=7)

    assert aggregate["runs"] == 50
    assert 0.0 <= aggregate["radiant_win_rate"] <= 1.0
    # Histogram counts sum to the number of runs.
    assert sum(b["count"] for b in aggregate["duration_histogram"]) == 50
    d = aggregate["duration_seconds"]
    assert d["p25"] <= d["median"] <= d["p75"]
    assert aggregate["representative_sim_id"] == f"test-seed{rep_seed}"


def test_aggregate_is_deterministic() -> None:
    a1, _ = aggregate_scenario(SCENARIO, HEROES, runs=30, base_seed=3)
    a2, _ = aggregate_scenario(SCENARIO, HEROES, runs=30, base_seed=3)
    assert a1 == a2  # same request => same distribution


def test_representative_is_the_majority_side() -> None:
    aggregate, rep_seed = aggregate_scenario(SCENARIO, HEROES, runs=40, base_seed=5)
    # Re-simulate the representative seed; its winner must be the favored side.
    from dm_pipeline.prototype.sim_loop import simulate

    _, state = simulate(SCENARIO, HEROES, seed=rep_seed)
    favored = "radiant" if aggregate["radiant_win_rate"] >= 0.5 else "dire"
    assert state.winner == favored


def test_run_and_export_writes_the_representative_sim(tmp_path) -> None:
    aggregate = run_and_export(SCENARIO, runs=20, base_seed=9, sim_dir=tmp_path, heroes=HEROES)
    sim_file = tmp_path / f"sim.{aggregate['representative_sim_id']}.json"
    assert sim_file.exists()
    stored = json.loads(sim_file.read_text())
    assert stored["id"] == aggregate["representative_sim_id"]
    assert stored["timeline"]  # a full watchable game
