"""Tests for hero XP/levels and first blood."""

from __future__ import annotations

from dm_pipeline.prototype.scenario import Scenario
from dm_pipeline.prototype.sim_loop import _level_for_xp, simulate

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
SCENARIO = Scenario(patch_id="test", radiant=["carry", "supp"], dire=["mid", "off"])


def test_level_curve_thresholds() -> None:
    assert _level_for_xp(0) == 1
    assert _level_for_xp(239) == 1
    assert _level_for_xp(240) == 2  # cum(2) = 60·1·4
    assert _level_for_xp(2399) == 5
    assert _level_for_xp(2400) == 6  # cum(6) = 60·5·8 — ultimate online
    assert _level_for_xp(10**9) == 30  # capped


def test_heroes_level_up_and_carries_outlevel_supports() -> None:
    timeline, state = simulate(SCENARIO, HEROES, seed=11)

    carry = next(h for h in state.radiant.heroes if h.display_name == "Carry")
    supp = next(h for h in state.radiant.heroes if h.display_name == "Supp")
    assert carry.level >= 6
    assert carry.xp > supp.xp  # farm priority drives XP
    assert carry.level >= supp.level  # levels can tie inside a band, never invert

    six = [e for e in timeline.events
           if e.type.value == "level_up" and e.payload["level"] == 6]
    assert {e.payload["hero"] for e in six} >= {"Carry", "Mid"}
    carry_six = next(e for e in six if e.payload["hero"] == "Carry")
    supp_six = next((e for e in six if e.payload["hero"] == "Supp"), None)
    if supp_six is not None:
        assert carry_six.t <= supp_six.t


def test_first_blood_fires_exactly_once_on_first_casualty() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=11)

    fights = [e for e in timeline.events if e.type.value == "fight"]
    fb = [e for e in fights if e.payload.get("first_blood")]
    with_deaths = [
        e for e in fights
        if e.payload.get("radiant_deaths") or e.payload.get("dire_deaths")
    ]
    assert len(fb) == 1
    assert with_deaths and fb[0] is with_deaths[0]


def test_hero_snapshot_carries_levels() -> None:
    timeline, _ = simulate(SCENARIO, HEROES, seed=11)
    last_econ = [e for e in timeline.events if e.type.value == "economy"][-1]
    for entry in last_econ.payload["radiant_heroes"]:
        assert entry["level"] >= 6


def test_spike_edge_counts_ult_tiers() -> None:
    from dm_pipeline.prototype.sim_loop import (
        _ULT_TIER_NETWORTH,
        GameState,
        HeroState,
        TeamState,
        _spike_edge,
    )

    def team(name: str, levels: list[int]) -> TeamState:
        return TeamState(
            name,
            [HeroState(key=f"h{i}", display_name=f"H{i}", farm_priority=1.0, level=lv)
             for i, lv in enumerate(levels)],
        )

    # Radiant: levels 6 and 12 => 1 + 2 = 3 tiers. Dire: 5 and 5 => 0 tiers.
    state = GameState(radiant=team("radiant", [6, 12]), dire=team("dire", [5, 5]))
    assert _spike_edge(state) == 3 * _ULT_TIER_NETWORTH

    # Both maxed => no edge.
    state = GameState(radiant=team("radiant", [18, 18]), dire=team("dire", [18, 18]))
    assert _spike_edge(state) == 0.0


def test_kda_is_counted_and_conserved() -> None:
    timeline, state = simulate(SCENARIO, HEROES, seed=11)

    radiant = state.radiant.heroes
    dire = state.dire.heroes
    # Every dire death is exactly one radiant kill, and vice versa.
    assert sum(h.kills for h in radiant) == sum(h.deaths for h in dire)
    assert sum(h.kills for h in dire) == sum(h.deaths for h in radiant)
    assert sum(h.deaths for h in radiant + dire) > 0  # fights happened

    # The per-hero snapshot carries the counters.
    last_econ = [e for e in timeline.events if e.type.value == "economy"][-1]
    entry = last_econ.payload["radiant_heroes"][0]
    assert {"kills", "deaths", "assists"} <= set(entry)


def test_kda_shapes_cores_frag_supports_assist() -> None:
    heroes = {
        f"h{i}": {
            "id": i,
            "display_name": f"H{i}",
            "roles": ["carry"] if i % 5 < 3 else ["support"],
            "attack_type": "melee",
            "base_stats": {"str": 20, "agi": 20, "int": 20},
        }
        for i in range(10)
    }
    scenario = Scenario(
        patch_id="test",
        radiant=[f"h{i}" for i in range(5)],
        dire=[f"h{i}" for i in range(5, 10)],
    )
    _, state = simulate(scenario, heroes, seed=11)

    for team in (state.radiant, state.dire):
        cores = [h for h in team.heroes if h.farm_priority > 0.9]
        sups = [h for h in team.heroes if h.farm_priority <= 0.9]
        team_kills = sum(h.kills for h in team.heroes)
        if team_kills < 10:
            continue  # a stomped side may not have enough sample to assert shape
        top_killer = max(team.heroes, key=lambda h: h.kills)
        assert top_killer in cores  # cores frag
        mean_sup_assists = sum(h.assists for h in sups) / len(sups)
        mean_core_assists = sum(h.assists for h in cores) / len(cores)
        assert mean_sup_assists > mean_core_assists  # supports set up


def test_kills_grant_experience() -> None:
    from dm_pipeline.prototype.sim_loop import (
        _XP_BASE_PER_TICK,
        _XP_PER_PRIORITY,
        TICK_SECONDS,
    )

    _, state = simulate(SCENARIO, HEROES, seed=11)
    ticks = state.t // TICK_SECONDS
    killers = [h for h in state.radiant.heroes + state.dire.heroes if h.kills > 0]
    assert killers, "seed must produce kills"
    for hero in killers:
        passive = ticks * (_XP_BASE_PER_TICK + _XP_PER_PRIORITY * hero.farm_priority)
        assert hero.xp > passive + 100  # fight XP on top of creep XP


def test_items_complete_at_thresholds_and_are_rng_free() -> None:
    from dm_pipeline.prototype.sim_loop import _ITEM_NETWORTH_THRESHOLDS

    builds = {
        "generic": [
            {"key": "a", "display_name": "Item A", "cost": 4000},
            {"key": "b", "display_name": "Item B", "cost": 4000},
            {"key": "c", "display_name": "Item C", "cost": 4000},
        ],
        "heroes": {},
    }
    # Same seed, builds on vs off: the item tick consumes no RNG, so the game
    # itself is untouched — identical winner and identical net-worth trajectory.
    # (The economy snapshot legitimately gains an `items` list; that's the only
    # difference, so we compare the net-worth series, not the raw payloads.)
    t_off, s_off = simulate(SCENARIO, HEROES, seed=11)
    t_on, s_on = simulate(SCENARIO, HEROES, seed=11, builds=builds)
    assert s_off.winner == s_on.winner
    networth = lambda tl: [
        (e.t, e.payload["radiant_net_worth"], e.payload["dire_net_worth"])
        for e in tl.events if e.type.value == "economy"
    ]
    assert networth(t_off) == networth(t_on)  # the item tick perturbed nothing

    items = [e for e in t_on.events if e.type.value == "item"]
    assert items, "heroes should complete items"
    # Each item fires only once net worth has crossed its threshold.
    for e in items:
        entry = next(
            h for side in ("radiant_heroes", "dire_heroes")
            for h in _econ_at(t_on, e.t)[side] if h["hero"] == e.payload["hero"]
        )
        assert entry["net_worth"] >= _ITEM_NETWORTH_THRESHOLDS[e.payload["nth"] - 1]
    # The final economy snapshot carries every completed item, in order.
    final = _econ_at(t_on, s_on.t)
    for hero in s_on.radiant.heroes + s_on.dire.heroes:
        entry = next(
            h for side in ("radiant_heroes", "dire_heroes")
            for h in final[side] if h["hero"] == hero.display_name
        )
        assert entry["items"] == hero.items


def _econ_at(timeline, t):
    return next(
        e.payload for e in reversed(timeline.events)
        if e.type.value == "economy" and e.t <= t
    )


def test_first_blood_lands_in_the_opening_window() -> None:
    from dm_pipeline.prototype.sim_loop import (
        _FIGHT_CHANCE,
        _FIRST_BLOOD_FIGHT_CHANCE,
        _FIRST_BLOOD_WINDOW_SECONDS,
    )

    assert _FIRST_BLOOD_FIGHT_CHANCE > _FIGHT_CHANCE  # opening is elevated

    # Across seeds, most first bloods fall inside the opening window (real
    # Divine: ~86% within 2 min). Two-hero teams still skirmish early.
    early = total = 0
    for seed in range(30):
        timeline, _ = simulate(SCENARIO, HEROES, seed=seed)
        fb = next(
            (e for e in timeline.events
             if e.type.value == "fight" and e.payload.get("first_blood")),
            None,
        )
        if fb is None:
            continue
        total += 1
        early += fb.t <= _FIRST_BLOOD_WINDOW_SECONDS
    assert total and early / total >= 0.7  # front-loaded like real games
