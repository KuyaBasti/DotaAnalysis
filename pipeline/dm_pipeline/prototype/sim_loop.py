"""Deterministic discrete-event simulation (prototype).

Stage 3, now scenario-driven: the loop simulates a match between two real drafts
(heroes resolved from a snapshot). A per-hero economy varies by role, a laning
model gives the stronger early-game draft a head start, and an analytic resolver
decides fights from the net-worth state. Numbers are uncalibrated — a bad
complete loop beats a perfect fragment; you can only calibrate a closed loop.

The load-bearing property remains determinism: same scenario + same seed produce
a byte-identical timeline (see tests/test_sim_determinism.py).
"""

from __future__ import annotations

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
WIN_NETWORTH_LEAD = 25_000  # team net-worth lead at which the trailing ancient falls

_FIGHT_CHANCE = 0.18  # chance a teamfight breaks out in a given tick (uncalibrated)
_DRAFT_PRIOR_NETWORTH = 8000.0  # starting net-worth edge a decisive draft (p=1) is worth
_STRENGTH_TO_NETWORTH = 16000.0  # net-worth-equivalent value of one point of draft strength in fights (tuned on n=1500)


@dataclass
class HeroState:
    key: str
    display_name: str
    farm_priority: float
    strength: float = 1.0  # data-derived multiplier (~1.0); 1.0 = neutral
    net_worth: float = 0.0


@dataclass
class TeamState:
    name: str
    heroes: list[HeroState] = field(default_factory=list)
    lane_power: float = 0.0

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
        _laning_tick(state, timeline)
        _maybe_fight(state, rng, timeline)
        _check_win(state)

    if state.winner is None:  # reached the time cap with no decisive lead
        lead = state.radiant.net_worth - state.dire.net_worth
        state.winner = "radiant" if lead >= 0 else "dire"
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
            },
        )
    )


def _team_economy(team: TeamState, rng: SeededRng) -> float:
    total = 0.0
    for hero in team.heroes:
        gain = hero_gold_gain(rng, hero.farm_priority, hero.strength)
        hero.net_worth += gain
        total += gain
    return total


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


def _maybe_fight(state: GameState, rng: SeededRng, timeline: Timeline) -> None:
    if not rng.chance(_FIGHT_CHANCE):
        return
    strength_edge = _STRENGTH_TO_NETWORTH * (
        state.radiant.strength_edge - state.dire.strength_edge
    )
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
    timeline.emit(
        Event(
            t=state.t,
            type=EventType.FIGHT,
            payload={
                "winner": outcome.winner,
                "swing": round(outcome.swing, 1),
                "radiant_win_prob": round(outcome.radiant_win_prob, 3),
            },
        )
    )


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


def _check_win(state: GameState) -> None:
    lead = state.radiant.net_worth - state.dire.net_worth
    if abs(lead) >= WIN_NETWORTH_LEAD:
        state.game_over = True
        state.winner = "radiant" if lead > 0 else "dire"


# A demo scenario of standard heroes (keys must exist in the loaded snapshot).
_DEMO_SCENARIO = Scenario(
    patch_id="7.39c",
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
    args = parser.parse_args(argv)

    if args.model:
        timeline, state = run_with_model(_DEMO_SCENARIO, seed=args.seed)
    else:
        timeline, state = run_scenario(_DEMO_SCENARIO, seed=args.seed)
    if args.timeline:
        print(json.dumps(timeline.to_list(), indent=2))
    if args.export:
        result = sim_result(_DEMO_SCENARIO, timeline, state, seed=args.seed)
        out_path = config.SIM_OUT_DIR / f"sim.{result['id']}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2, sort_keys=True))
        print(f"exported {out_path}")
    print(
        f"seed {args.seed}: {state.winner} wins at "
        f"{state.t // 60}:{state.t % 60:02d} — "
        f"radiant {round(state.radiant.net_worth):,} vs "
        f"dire {round(state.dire.net_worth):,} "
        f"({len(timeline.events)} events)"
    )


if __name__ == "__main__":
    main()
