"""Tests for the draft-prior starting advantage in the sim."""

from __future__ import annotations

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import simulate

HEROES = {
    "a": {"display_name": "A", "roles": ["carry"], "attack_type": "melee",
          "base_stats": {"str": 20, "agi": 20, "int": 20}},
    "b": {"display_name": "B", "roles": ["support"], "attack_type": "ranged",
          "base_stats": {"str": 18, "agi": 18, "int": 22}},
    "c": {"display_name": "C", "roles": ["nuker"], "attack_type": "ranged",
          "base_stats": {"str": 19, "agi": 19, "int": 21}},
    "d": {"display_name": "D", "roles": ["carry"], "attack_type": "melee",
          "base_stats": {"str": 21, "agi": 21, "int": 18}},
}
SCENARIO = Scenario(patch_id="test", radiant=["a", "b"], dire=["c", "d"])


def test_no_draft_prior_event_by_default() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=1)
    assert all(e.type.value != "draft_prior" for e in timeline.events)


def test_draft_prior_emits_event_seeded_in_the_favored_direction() -> None:
    radiant_favored, _ = simulate(SCENARIO, HEROES, seed=1, draft_prior=0.9)
    dire_favored, _ = simulate(SCENARIO, HEROES, seed=1, draft_prior=0.1)

    lead_r = next(
        e for e in radiant_favored.events if e.type.value == "draft_prior"
    ).payload["radiant_lead"]
    lead_d = next(
        e for e in dire_favored.events if e.type.value == "draft_prior"
    ).payload["radiant_lead"]
    assert lead_r > 0 > lead_d  # radiant-favored => +lead; dire-favored => -lead


def test_even_draft_prior_seeds_no_lead() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=1, draft_prior=0.5)
    event = next(e for e in timeline.events if e.type.value == "draft_prior")
    assert event.payload["radiant_lead"] == 0.0
