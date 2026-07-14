"""Deterministic discrete-event simulation (prototype).

Stage 3, now scenario-driven: the loop simulates a match between two real drafts
(heroes resolved from a snapshot). A per-hero economy varies by role, a laning
model gives the stronger draft an early head start, an analytic resolver decides
fights (naming who falls), the leading team contests Roshan for the Aegis, and an
objectives model turns the net-worth lead into towers, barracks, and finally the
Ancient — so the match ends like a real one. Numbers are uncalibrated — a bad
complete loop beats a perfect fragment.

The load-bearing property remains determinism: same scenario + same seed produce
a byte-identical timeline (see tests/test_sim_determinism.py).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from dm_pipeline import config
from dm_pipeline.prototype.economy import farm_priority, hero_gold_gain
from dm_pipeline.prototype.events import Event, EventType
from dm_pipeline.prototype.fight_v0 import resolve_fight
from dm_pipeline.prototype.laning import (
    LANING_END_SECONDS,
    laning_gold_split,
    team_lane_power,
)
from dm_pipeline.prototype.rng import SeededRng
from dm_pipeline.prototype.scenario import Scenario, load_heroes
from dm_pipeline.prototype.timeline import Timeline

TICK_SECONDS = 30
MAX_TIME = 60 * 60  # 60-minute hard cap

# Objectives: the team ahead pushes and destroys enemy structures in order; the
# Ancient is the last one and ends the game.
_OBJECTIVE_START_SECONDS = 8 * 60  # towers are too tanky to take before ~8 min
_STRUCTURES = ("tier-1 tower", "tier-2 tower", "tier-3 tower", "barracks", "ancient")
_LANES = ("top", "mid", "bot")  # where a tower/barracks falls (flavor for the map)
_OBJECTIVE_BASE_CHANCE = 0.15  # per-tick chance the leader takes the next structure (at full lead; tuned so mean game length ~= real 23.6m, accounting for Roshan gold)
_OBJECTIVE_LEAD_FULL = 12_000.0  # net-worth lead at which that chance maxes out

# Roshan: the leading team contests it when up; the Aegis is a real net-worth swing.
_ROSHAN_FIRST_SECONDS = 10 * 60  # worth contesting from ~10 min
_ROSHAN_RESPAWN_SECONDS = 9 * 60  # respawn window after a kill
_ROSHAN_CHANCE = 0.15  # per-tick chance the leader takes an available Roshan
_ROSHAN_REWARD = 2500.0  # net-worth value of the Aegis + bounty

_FIGHT_CHANCE = 0.18  # chance a teamfight breaks out in a given tick (uncalibrated)
_DRAFT_PRIOR_NETWORTH = 8000.0  # starting net-worth edge a decisive draft (p=1) is worth
_STRENGTH_TO_NETWORTH = 16000.0  # net-worth-equivalent value of one point of draft strength in fights (tuned on n=1500)

# Experience: XP tracks farm plus a passive floor so supports still level, and
# the curve approximates the real table (level 6 ~2,400 cumulative XP). Cores
# hit 6 around minute 6, supports a few minutes later.
_XP_BASE_PER_TICK = 80.0
_XP_PER_GOLD = 1.5
_MAX_LEVEL = 30
_MILESTONE_LEVELS = (6, 12, 18, 25)  # ult + big talent tiers; only these are emitted

# Power spikes: an ultimate (and each upgrade tier) online is worth real fight
# strength, expressed in gold-equivalent like the draft edge. A full 5-ult
# advantage (~min 4-9 vs a slower-leveling draft) is a ~61% fight favorite.
_ULT_TIER_LEVELS = (6, 12, 18)
_ULT_TIER_NETWORTH = 900.0  # fight value of each ult tier a hero has online


def _level_for_xp(xp: float) -> int:
    """Cumulative XP -> level, via cum(L) = 60·(L−1)·(L+2) (≈ the real curve)."""
    level = 1
    while level < _MAX_LEVEL and xp >= 60.0 * level * (level + 3):
        level += 1
    return level


@dataclass
class HeroState:
    key: str
    display_name: str
    farm_priority: float
    strength: float = 1.0  # data-derived multiplier (~1.0); 1.0 = neutral
    net_worth: float = 0.0
    xp: float = 0.0
    level: int = 1
    kills: int = 0
    deaths: int = 0
    assists: int = 0


@dataclass
class TeamState:
    name: str
    heroes: list[HeroState] = field(default_factory=list)
    lane_power: float = 0.0
    objectives: int = 0  # enemy structures destroyed; len(_STRUCTURES) = Ancient down
    kill_rotation: int = 0  # deterministic round-robin for kill credit (rng-free)

    @property
    def net_worth(self) -> float:
        return sum(h.net_worth for h in self.heroes)

    @property
    def strength_edge(self) -> float:
        """Summed hero strength above neutral (0 for an average draft)."""
        return sum(h.strength - 1.0 for h in self.heroes)


@dataclass
class GameState:
    radiant: TeamState
    dire: TeamState
    t: int = 0
    game_over: bool = False
    winner: str | None = None
    roshan_available_at: int = _ROSHAN_FIRST_SECONDS  # game-time the next Roshan can be taken
    first_blood_done: bool = False
    last_fight_t: int = -1  # tick a fight last fired (positions cluster there)
    last_fight_xy: tuple[float, float] = (50.0, 50.0)


def simulate(
    scenario: Scenario,
    heroes: dict[str, dict[str, Any]],
    *,
    seed: int,
    draft_prior: float | None = None,
    ratings: dict[int, float] | None = None,
) -> tuple[Timeline, GameState]:
    """Run one full match for a scenario. Returns timeline and final state.

    ``heroes`` is the patch's hero data keyed by hero key (see
    ``scenario.load_heroes``); passing it in keeps simulate() testable offline.
    """
    rng = SeededRng(seed)
    state = GameState(
        radiant=_build_team("radiant", scenario.radiant, heroes, ratings),
        dire=_build_team("dire", scenario.dire, heroes, ratings),
    )
    timeline = Timeline()
    timeline.emit(
        Event(
            t=0,
            type=EventType.GAME_START,
            payload={
                "seed": seed,
                "patch_id": scenario.patch_id,
                "radiant": scenario.radiant,
                "dire": scenario.dire,
            },
        )
    )

    if draft_prior is not None:
        _apply_draft_prior(state, draft_prior, timeline)

    while not state.game_over and state.t < MAX_TIME:
        state.t += TICK_SECONDS
        _economy_tick(state, rng, timeline)
        _level_tick(state, timeline)
        _laning_tick(state, timeline)
        _maybe_fight(state, rng, timeline)
        _roshan_tick(state, rng, timeline)
        _objectives_tick(state, rng, timeline)
        _positions_tick(state, timeline)

    if state.winner is None:  # time cap, no Ancient fell — decide on objectives, then net worth
        radiant, dire = state.radiant, state.dire
        if radiant.objectives != dire.objectives:
            state.winner = "radiant" if radiant.objectives > dire.objectives else "dire"
        else:
            state.winner = "radiant" if radiant.net_worth >= dire.net_worth else "dire"
        state.game_over = True

    timeline.emit(
        Event(
            t=state.t,
            type=EventType.GAME_OVER,
            payload={
                "winner": state.winner,
                "radiant_net_worth": round(state.radiant.net_worth, 1),
                "dire_net_worth": round(state.dire.net_worth, 1),
            },
        )
    )
    return timeline, state


def run_scenario(
    scenario: Scenario, *, seed: int, ratings: dict[int, float] | None = None
) -> tuple[Timeline, GameState]:
    """Convenience: load the scenario's patch heroes from disk, then simulate."""
    return simulate(
        scenario, load_heroes(scenario.patch_id), seed=seed, ratings=ratings
    )


def run_with_model(scenario: Scenario, *, seed: int) -> tuple[Timeline, GameState]:
    """Like run_scenario, but seed a draft prior from the trained win-prob model.

    Maps the scenario's hero keys to ids (via the snapshot), asks the model for
    P(radiant wins), and feeds that to the sim as a starting advantage.
    """
    from dm_pipeline.models.win_probability.predict import (
        load_win_prob_model,
        predict_draft,
    )

    heroes = load_heroes(scenario.patch_id)
    bundle = load_win_prob_model()
    radiant_ids = [heroes[key]["id"] for key in scenario.radiant]
    dire_ids = [heroes[key]["id"] for key in scenario.dire]
    prior = predict_draft(bundle, radiant_ids, dire_ids)
    return simulate(scenario, heroes, seed=seed, draft_prior=prior)


def sim_result(
    scenario: Scenario, timeline: Timeline, state: GameState, *, seed: int
) -> dict[str, Any]:
    """A JSON-serializable summary + timeline for one simulated match.

    This is the shape the API serves and the web viewer renders.
    """
    return {
        "id": f"{scenario.patch_id}-seed{seed}",
        "patch_id": scenario.patch_id,
        "seed": seed,
        "radiant": scenario.radiant,
        "dire": scenario.dire,
        "summary": {
            "winner": state.winner,
            "duration_seconds": state.t,
            "radiant_net_worth": round(state.radiant.net_worth, 1),
            "dire_net_worth": round(state.dire.net_worth, 1),
            "radiant_objectives": state.radiant.objectives,
            "dire_objectives": state.dire.objectives,
        },
        "timeline": timeline.to_list(),
    }


def _build_team(
    name: str,
    keys: list[str],
    heroes: dict[str, dict[str, Any]],
    ratings: dict[int, float] | None = None,
) -> TeamState:
    ratings = ratings or {}
    states: list[HeroState] = []
    hero_dicts: list[dict[str, Any]] = []
    for key in keys:
        hero = heroes.get(key)
        if hero is None:
            raise ValueError(f"unknown hero key: {key!r}")
        hero_dicts.append(hero)
        states.append(
            HeroState(
                key=key,
                display_name=hero["display_name"],
                farm_priority=farm_priority(hero.get("roles", [])),
                strength=ratings.get(hero.get("id"), 1.0),
            )
        )
    return TeamState(name, states, lane_power=team_lane_power(hero_dicts))


def _economy_tick(state: GameState, rng: SeededRng, timeline: Timeline) -> None:
    radiant_gain = _team_economy(state.radiant, rng)
    dire_gain = _team_economy(state.dire, rng)
    timeline.emit(
        Event(
            t=state.t,
            type=EventType.ECONOMY,
            payload={
                "radiant_gain": round(radiant_gain, 1),
                "dire_gain": round(dire_gain, 1),
                "radiant_net_worth": round(state.radiant.net_worth, 1),
                "dire_net_worth": round(state.dire.net_worth, 1),
                # Per-hero snapshot so viewers can render individual economies.
                "radiant_heroes": _hero_networths(state.radiant),
                "dire_heroes": _hero_networths(state.dire),
            },
        )
    )


def _hero_networths(team: TeamState) -> list[dict[str, Any]]:
    return [
        {
            "hero": h.display_name,
            "net_worth": round(h.net_worth, 1),
            "level": h.level,
            "kills": h.kills,
            "deaths": h.deaths,
            "assists": h.assists,
        }
        for h in team.heroes
    ]


def _team_economy(team: TeamState, rng: SeededRng) -> float:
    total = 0.0
    for hero in team.heroes:
        gain = hero_gold_gain(rng, hero.farm_priority, hero.strength)
        hero.net_worth += gain
        hero.xp += _XP_BASE_PER_TICK + gain * _XP_PER_GOLD
        total += gain
    return total


def _level_tick(state: GameState, timeline: Timeline) -> None:
    """Advance hero levels from accrued XP; announce the milestone levels."""
    for team in (state.radiant, state.dire):
        for hero in team.heroes:
            new_level = _level_for_xp(hero.xp)
            if new_level <= hero.level:
                continue
            for milestone in _MILESTONE_LEVELS:
                if hero.level < milestone <= new_level:
                    timeline.emit(
                        Event(
                            t=state.t,
                            type=EventType.LEVEL_UP,
                            payload={
                                "team": team.name,
                                "hero": hero.display_name,
                                "level": milestone,
                            },
                        )
                    )
            hero.level = new_level


def _laning_tick(state: GameState, timeline: Timeline) -> None:
    """During the laning phase, the stronger-laning team accrues a gold edge."""
    if state.t > LANING_END_SECONDS:
        return
    radiant_bonus, dire_bonus = laning_gold_split(
        state.radiant.lane_power, state.dire.lane_power
    )
    if radiant_bonus == 0.0 and dire_bonus == 0.0:
        return
    _distribute(state.radiant, radiant_bonus)
    _distribute(state.dire, dire_bonus)
    timeline.emit(
        Event(
            t=state.t,
            type=EventType.LANING,
            payload={
                "radiant_bonus": round(radiant_bonus, 1),
                "dire_bonus": round(dire_bonus, 1),
            },
        )
    )


def _spike_edge(state: GameState) -> float:
    """Radiant-minus-dire fight edge from ult tiers online, in gold-equivalent."""

    def tiers(team: TeamState) -> int:
        return sum(
            sum(1 for m in _ULT_TIER_LEVELS if h.level >= m) for h in team.heroes
        )

    return _ULT_TIER_NETWORTH * (tiers(state.radiant) - tiers(state.dire))


def _maybe_fight(state: GameState, rng: SeededRng, timeline: Timeline) -> None:
    if not rng.chance(_FIGHT_CHANCE):
        return
    strength_edge = _STRENGTH_TO_NETWORTH * (
        state.radiant.strength_edge - state.dire.strength_edge
    ) + _spike_edge(state)
    outcome = resolve_fight(
        state.radiant.net_worth,
        state.dire.net_worth,
        rng,
        strength_edge=strength_edge,
    )
    won, lost = (
        (state.radiant, state.dire)
        if outcome.winner == "radiant"
        else (state.dire, state.radiant)
    )
    _distribute(won, outcome.swing)
    _distribute(lost, -outcome.swing * 0.5)

    # Narrative casualties: the losing side takes the brunt, the winner maybe one.
    loser_dead = (
        rng.sample(lost.heroes, rng.randint(1, min(3, len(lost.heroes))))
        if lost.heroes
        else []
    )
    winner_dead = rng.sample(won.heroes, 1) if won.heroes and rng.chance(0.35) else []
    _credit_kda(won, loser_dead)
    _credit_kda(lost, winner_dead)
    if outcome.winner == "radiant":
        radiant_deaths = [h.display_name for h in winner_dead]
        dire_deaths = [h.display_name for h in loser_dead]
    else:
        radiant_deaths = [h.display_name for h in loser_dead]
        dire_deaths = [h.display_name for h in winner_dead]

    payload: dict[str, Any] = {
        "winner": outcome.winner,
        "swing": round(outcome.swing, 1),
        "radiant_win_prob": round(outcome.radiant_win_prob, 3),
        "radiant_deaths": radiant_deaths,
        "dire_deaths": dire_deaths,
    }
    if outcome.comeback_factor >= 1.2:  # the trailing team cashed real bounties
        payload["comeback"] = True
    state.last_fight_t = state.t
    state.last_fight_xy = _fight_spot(state)
    payload["x"], payload["y"] = round(state.last_fight_xy[0], 1), round(
        state.last_fight_xy[1], 1
    )
    if not state.first_blood_done and (radiant_deaths or dire_deaths):
        payload["first_blood"] = True
        state.first_blood_done = True
    timeline.emit(Event(t=state.t, type=EventType.FIGHT, payload=payload))


def _credit_kda(killers: TeamState, fallen: list[HeroState]) -> None:
    """Count kills/deaths/assists for a fight's casualties.

    Deliberately rng-free (like positions): kill credit rotates round-robin
    through the killing team, everyone else on it gets the assist — so adding
    stats cannot change any match outcome.
    """
    for hero in fallen:
        hero.deaths += 1
        if not killers.heroes:
            continue
        killer = killers.heroes[killers.kill_rotation % len(killers.heroes)]
        killers.kill_rotation += 1
        killer.kills += 1
        for mate in killers.heroes:
            if mate is not killer:
                mate.assists += 1


def _distribute(team: TeamState, amount: float) -> None:
    if not team.heroes:
        return
    share = amount / len(team.heroes)
    for hero in team.heroes:
        hero.net_worth += share


def _apply_draft_prior(
    state: GameState, radiant_win_prob: float, timeline: Timeline
) -> None:
    """Seed a starting net-worth edge from the draft model's prediction.

    p=0.5 => no edge; p>0.5 => radiant starts ahead, p<0.5 => dire does. The
    existing economy/fight dynamics then carry the lead forward.
    """
    lead = _DRAFT_PRIOR_NETWORTH * (2.0 * radiant_win_prob - 1.0)
    _distribute(state.radiant, lead)
    timeline.emit(
        Event(
            t=0,
            type=EventType.DRAFT_PRIOR,
            payload={
                "radiant_win_prob": round(radiant_win_prob, 3),
                "radiant_lead": round(lead, 1),
            },
        )
    )


def _roshan_tick(state: GameState, rng: SeededRng, timeline: Timeline) -> None:
    """The leading team contests Roshan when it's up; the Aegis is a real swing.

    Roshan is worth taking from ~10 min and respawns ~9 min after each kill. The
    net-worth leader claims it (chance per tick) and banks the Aegis + bounty.
    """
    if state.t < state.roshan_available_at:
        return
    lead = state.radiant.net_worth - state.dire.net_worth
    if lead == 0 or not rng.chance(_ROSHAN_CHANCE):
        return

    leader = state.radiant if lead > 0 else state.dire
    _distribute(leader, _ROSHAN_REWARD)
    state.roshan_available_at = state.t + _ROSHAN_RESPAWN_SECONDS
    timeline.emit(
        Event(
            t=state.t,
            type=EventType.ROSHAN,
            payload={"team": leader.name, "reward": round(_ROSHAN_REWARD, 1)},
        )
    )


# --- Positions (presentational, deliberately rng-free) ----------------------
# Hero map positions are pure functions of time, hero index, and game state, so
# they never consume rng draws — the minimap is a lens on the sim, and adding it
# cannot change any match outcome. Coordinates live in the same 0..100 square
# the web minimap draws (Radiant base bottom-left, Dire top-right).

_MAP_BASE = {"radiant": (18.0, 82.0), "dire": (82.0, 18.0)}
# Laning spots sit near each side's tier-1 towers. Radiant's safelane is bot,
# Dire's is top; offlanes mirror.
_LANING_SPOTS = {
    "radiant": {"safe": (66.0, 86.0), "mid": (44.0, 56.0), "off": (16.0, 30.0)},
    "dire": {"safe": (34.0, 14.0), "mid": (56.0, 44.0), "off": (84.0, 70.0)},
}
_LANE_ROLES = ("safe", "mid", "off", "safe", "off")  # by farm priority: cores then sups
_FRONT_BASE = 0.22  # how far up the map a team sits with no structures taken
_FRONT_PER_OBJECTIVE = 0.13  # each enemy structure taken pushes the front deeper
_FRONT_LEAD_NUDGE = 0.05  # being ahead in gold pushes a bit further


def _assign_lanes(team: TeamState) -> dict[str, str]:
    """Deterministic 2-1-2: highest farm priority safelane, then mid, then off."""
    ordered = sorted(team.heroes, key=lambda h: (-h.farm_priority, h.key))
    return {
        h.key: _LANE_ROLES[i % len(_LANE_ROLES)] for i, h in enumerate(ordered)
    }


def _front_point(state: GameState, side: str) -> tuple[float, float]:
    """Where a team's push front sits on the base-to-base diagonal."""
    team, enemy = (
        (state.radiant, state.dire) if side == "radiant" else (state.dire, state.radiant)
    )
    f = _FRONT_BASE + _FRONT_PER_OBJECTIVE * team.objectives
    if team.net_worth > enemy.net_worth:
        f += _FRONT_LEAD_NUDGE
    f = min(f, 0.9)
    (x0, y0), (x1, y1) = _MAP_BASE[side], _MAP_BASE["dire" if side == "radiant" else "radiant"]
    return (x0 + f * (x1 - x0), y0 + f * (y1 - y0))


def _fight_spot(state: GameState) -> tuple[float, float]:
    """Where a fight breaks out: mid river early, between the fronts later."""
    if state.t <= LANING_END_SECONDS:
        drift = 8.0 * math.sin(state.t / 120.0)  # wander along the river
        return (50.0 + drift, 50.0 + drift)
    (rx, ry), (dx, dy) = _front_point(state, "radiant"), _front_point(state, "dire")
    return ((rx + dx) / 2.0, (ry + dy) / 2.0)


def _wobble(t: int, i: int) -> tuple[float, float]:
    """Small deterministic motion so dots feel alive between phases."""
    return (2.0 * math.sin(t / 45.0 + i * 1.7), 2.0 * math.cos(t / 60.0 + i * 2.3))


def _positions_tick(state: GameState, timeline: Timeline) -> None:
    fighting = state.last_fight_t == state.t
    payload: dict[str, Any] = {}
    for side, team in (("radiant", state.radiant), ("dire", state.dire)):
        lanes = _assign_lanes(team)
        entries: list[dict[str, Any]] = []
        for i, hero in enumerate(team.heroes):
            if fighting:
                angle = i * 1.257 + (0.0 if side == "radiant" else 0.63)
                x = state.last_fight_xy[0] + 4.0 * math.cos(angle)
                y = state.last_fight_xy[1] + 4.0 * math.sin(angle)
            elif state.t <= LANING_END_SECONDS:
                sx, sy = _LANING_SPOTS[side][lanes[hero.key]]
                wx, wy = _wobble(state.t, i)
                # duo-lane partners stand apart instead of stacking
                x, y = sx + wx + (i - 2) * 1.5, sy + wy
            else:
                fx, fy = _front_point(state, side)
                wx, wy = _wobble(state.t, i)
                spread = (i - 2) * 5.0  # fan out perpendicular to the diagonal
                x = fx + spread * 0.707 + wx
                y = fy + spread * 0.707 + wy
            entries.append(
                {
                    "hero": hero.display_name,
                    "x": round(min(max(x, 2.0), 98.0), 1),
                    "y": round(min(max(y, 2.0), 98.0), 1),
                }
            )
        payload[f"{side}_heroes"] = entries
    timeline.emit(Event(t=state.t, type=EventType.POSITIONS, payload=payload))


def _objectives_tick(state: GameState, rng: SeededRng, timeline: Timeline) -> None:
    """The team ahead in net worth pushes and takes enemy structures over time.

    Chance scales with the net-worth lead; destroying the Ancient ends the game.
    Towers are too tanky to fall in the first several minutes.
    """
    if state.t < _OBJECTIVE_START_SECONDS:
        return
    lead = state.radiant.net_worth - state.dire.net_worth
    if lead == 0:
        return
    leader = state.radiant if lead > 0 else state.dire
    if leader.objectives >= len(_STRUCTURES):
        return

    chance = _OBJECTIVE_BASE_CHANCE * min(1.0, abs(lead) / _OBJECTIVE_LEAD_FULL)
    if not rng.chance(chance):
        return

    structure = _STRUCTURES[leader.objectives]
    leader.objectives += 1
    payload: dict[str, Any] = {
        "team": leader.name,
        "structure": structure,
        "destroyed": leader.objectives,  # enemy structures down so far
    }
    if structure != "ancient":  # towers and barracks fall in a lane
        payload["lane"] = rng.sample(_LANES, 1)[0]
    timeline.emit(Event(t=state.t, type=EventType.OBJECTIVE, payload=payload))
    if leader.objectives >= len(_STRUCTURES):  # the Ancient fell
        state.game_over = True
        state.winner = leader.name


# A demo scenario of standard heroes (keys must exist in the loaded snapshot).
_DEMO_SCENARIO = Scenario(
    patch_id="7.41d",
    radiant=["juggernaut", "crystal_maiden", "axe", "invoker", "lion"],
    dire=["phantom_assassin", "lich", "tidehunter", "storm_spirit", "witch_doctor"],
)


def main(argv: list[str] | None = None) -> None:
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Run the prototype DES sim once.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--timeline",
        action="store_true",
        help="print the full event timeline as JSON",
    )
    parser.add_argument(
        "--export",
        action="store_true",
        help="write the match result to data/sims/sim.<id>.json for the API",
    )
    parser.add_argument(
        "--model",
        action="store_true",
        help="seed a draft prior from the trained win-probability model",
    )
    parser.add_argument(
        "--radiant",
        help="comma-separated radiant hero keys (default: the demo draft)",
    )
    parser.add_argument(
        "--dire",
        help="comma-separated dire hero keys (default: the demo draft)",
    )
    parser.add_argument(
        "--patch",
        default=_DEMO_SCENARIO.patch_id,
        help="patch snapshot to draft from",
    )
    args = parser.parse_args(argv)

    if (args.radiant is None) != (args.dire is None):
        parser.error("--radiant and --dire must be given together")
    if args.radiant is not None:
        radiant = [k.strip() for k in args.radiant.split(",") if k.strip()]
        dire = [k.strip() for k in args.dire.split(",") if k.strip()]
        if not radiant or not dire:
            parser.error("--radiant and --dire each need at least one hero key")
        scenario = Scenario(patch_id=args.patch, radiant=radiant, dire=dire)
    else:
        scenario = _DEMO_SCENARIO

    if args.model:
        timeline, state = run_with_model(scenario, seed=args.seed)
    else:
        timeline, state = run_scenario(scenario, seed=args.seed)
    if args.timeline:
        print(json.dumps(timeline.to_list(), indent=2))
    if args.export:
        result = sim_result(scenario, timeline, state, seed=args.seed)
        out_path = config.SIM_OUT_DIR / f"sim.{result['id']}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2, sort_keys=True))
        print(f"exported {out_path}")
    print(
        f"seed {args.seed}: {state.winner} wins at "
        f"{state.t // 60}:{state.t % 60:02d} — "
        f"radiant {round(state.radiant.net_worth):,} ({state.radiant.objectives} structures) vs "
        f"dire {round(state.dire.net_worth):,} ({state.dire.objectives}) "
        f"({len(timeline.events)} events)"
    )


if __name__ == "__main__":
    main()
