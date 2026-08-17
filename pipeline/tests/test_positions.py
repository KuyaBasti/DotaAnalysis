"""Tests for the presentational position model (hero dots on the minimap)."""

from __future__ import annotations

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import simulate

HEROES = {
    "carry": {
        "id": 1,
        "display_name": "Carry",
        "roles": ["carry"],
        "attack_type": "melee",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    },
    "supp": {
        "id": 2,
        "display_name": "Supp",
        "roles": ["support"],
        "attack_type": "ranged",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    },
    "mid": {
        "id": 3,
        "display_name": "Mid",
        "roles": ["nuker"],
        "attack_type": "ranged",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    },
    "off": {
        "id": 4,
        "display_name": "Off",
        "roles": ["durable"],
        "attack_type": "melee",
        "base_stats": {"str": 20, "agi": 20, "int": 20},
    },
}
SCENARIO = Scenario(
    patch_id="test", radiant=["carry", "mid", "supp"], dire=["off", "supp", "mid"]
)


def _positions(timeline):
    return [e for e in timeline.events if e.type.value == "positions"]


def _entry(event, side, hero):
    return next(h for h in event.payload[f"{side}_heroes"] if h["hero"] == hero)


def test_positions_emitted_every_tick_within_bounds() -> None:
    timeline, state = simulate(SCENARIO, HEROES, seed=3)
    positions = _positions(timeline)
    ticks = {e.t for e in timeline.events if e.type.value == "economy"}
    assert {e.t for e in positions} == ticks  # one per tick
    for e in positions:
        for side in ("radiant", "dire"):
            for h in e.payload[f"{side}_heroes"]:
                assert 2.0 <= h["x"] <= 98.0 and 2.0 <= h["y"] <= 98.0


def test_laning_phase_puts_heroes_in_their_lanes() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=3)
    # A laning-phase tick with no fight (fight ticks cluster everyone mid-map).
    fight_ticks = {e.t for e in timeline.events if e.type.value == "fight"}
    early = next(e for e in _positions(timeline) if e.t not in fight_ticks)

    carry = _entry(early, "radiant", "Carry")  # radiant safelane = bot
    assert carry["x"] > 55 and carry["y"] > 75

    dire_supp = _entry(early, "dire", "Supp")  # lowest priority => offlane = bot for dire
    assert dire_supp["x"] > 75 and dire_supp["y"] > 60


def test_positions_are_deterministic_and_rng_free() -> None:
    # Positions must not consume rng: two runs agree, and the game outcome
    # matches a pre-positions baseline by construction (no new rng draws).
    t1, s1 = simulate(SCENARIO, HEROES, seed=9)
    t2, s2 = simulate(SCENARIO, HEROES, seed=9)
    assert [e.to_dict() for e in t1.events] == [e.to_dict() for e in t2.events]
    assert s1.winner == s2.winner


def test_heroes_keep_visibly_moving_between_fights() -> None:
    """A parked dot reads as a frozen sim, so pin a floor on ordinary motion.

    Measured on quiet ticks only (fight ticks cluster everyone and would flatter
    the number). The old ±2-unit wobble managed a median of ~1.4 units per tick
    — roughly 3 px on the 210 px minimap, which the eye reads as stationary and
    which a viewer reported as "the dots don't move". The roaming circuit puts
    this at ~3.1-3.4 across seeds; 2.5 sits clear of both.
    """
    for seed in (3, 9, 42):
        timeline, _ = simulate(SCENARIO, HEROES, seed=seed)
        fight_ticks = {e.t for e in timeline.events if e.type.value == "fight"}
        snapshots = _positions(timeline)
        steps = []
        for a, b in zip(snapshots, snapshots[1:]):
            if a.t in fight_ticks or b.t in fight_ticks:
                continue
            before = {
                h["hero"]: (h["x"], h["y"])
                for h in a.payload["radiant_heroes"] + a.payload["dire_heroes"]
            }
            for h in b.payload["radiant_heroes"] + b.payload["dire_heroes"]:
                if h["hero"] in before:
                    ox, oy = before[h["hero"]]
                    steps.append(((h["x"] - ox) ** 2 + (h["y"] - oy) ** 2) ** 0.5)

        assert steps, f"seed {seed} produced no quiet ticks to measure"
        steps.sort()
        median = steps[len(steps) // 2]
        assert median > 2.5, f"seed {seed}: heroes barely move (median {median:.2f})"


def test_fight_tick_clusters_everyone_at_the_fight() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=3)
    fights = [e for e in timeline.events if e.type.value == "fight"]
    assert fights, "seed must produce at least one fight"
    fight = fights[0]
    snapshot = next(e for e in _positions(timeline) if e.t == fight.t)

    dots = snapshot.payload["radiant_heroes"] + snapshot.payload["dire_heroes"]
    for h in dots:
        dist = ((h["x"] - fight.payload["x"]) ** 2 + (h["y"] - fight.payload["y"]) ** 2) ** 0.5
        assert dist <= 6.0  # everyone is at the brawl
