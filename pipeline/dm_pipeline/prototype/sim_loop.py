"""Deterministic discrete-event simulation skeleton (prototype).

This is Stage 3's "structural frame, floor 1": a game clock, the single seeded
RNG, a timeline emitter, and a win condition — the smallest *complete* loop that
runs start-to-finish and ends with a winner. The economy/fight numbers here are
a deliberate, uncalibrated placeholder; real economy, laning, and fight models
replace them in later verticals. A bad complete loop beats a perfect fragment —
you can only calibrate a closed loop.

The load-bearing property of this floor is determinism: the same seed produces a
byte-identical timeline, forever (see tests/test_sim_determinism.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from dm_pipeline.prototype.events import Event, EventType
from dm_pipeline.prototype.rng import SeededRng
from dm_pipeline.prototype.timeline import Timeline

TICK_SECONDS = 30
MAX_TIME = 60 * 60  # 60-minute hard cap
WIN_NETWORTH_LEAD = 25_000  # lead at which the trailing ancient falls

# Placeholder economy/fight tuning — NOT calibrated (see module docstring).
_GOLD_PER_TICK = (180.0, 320.0)  # per-team gold earned each macro tick
_FIGHT_CHANCE = 0.18  # chance a teamfight breaks out in a given tick
_FIGHT_SWING = (1500.0, 5000.0)  # net-worth swing to the fight's winner


@dataclass
class TeamState:
    name: str
    net_worth: float = 0.0


@dataclass
class GameState:
    t: int = 0
    radiant: TeamState = field(default_factory=lambda: TeamState("radiant"))
    dire: TeamState = field(default_factory=lambda: TeamState("dire"))
    game_over: bool = False
    winner: str | None = None


def simulate(seed: int) -> tuple[Timeline, GameState]:
    """Run one full match. Returns its event timeline and final game state."""
    rng = SeededRng(seed)
    state = GameState()
    timeline = Timeline()
    timeline.emit(Event(t=0, type=EventType.GAME_START, payload={"seed": seed}))

    while not state.game_over and state.t < MAX_TIME:
        state.t += TICK_SECONDS
        _economy_tick(state, rng, timeline)
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


def _economy_tick(state: GameState, rng: SeededRng, timeline: Timeline) -> None:
    radiant_gain = rng.uniform(*_GOLD_PER_TICK)
    dire_gain = rng.uniform(*_GOLD_PER_TICK)
    state.radiant.net_worth += radiant_gain
    state.dire.net_worth += dire_gain
    timeline.emit(
        Event(
            t=state.t,
            type=EventType.ECONOMY,
            payload={
                "radiant_gain": round(radiant_gain, 1),
                "dire_gain": round(dire_gain, 1),
            },
        )
    )


def _maybe_fight(state: GameState, rng: SeededRng, timeline: Timeline) -> None:
    if not rng.chance(_FIGHT_CHANCE):
        return
    swing = rng.uniform(*_FIGHT_SWING)
    winner = "radiant" if rng.chance(0.5) else "dire"
    won, lost = (
        (state.radiant, state.dire)
        if winner == "radiant"
        else (state.dire, state.radiant)
    )
    won.net_worth += swing
    lost.net_worth -= swing * 0.5
    timeline.emit(
        Event(
            t=state.t,
            type=EventType.FIGHT,
            payload={"winner": winner, "swing": round(swing, 1)},
        )
    )


def _check_win(state: GameState) -> None:
    lead = state.radiant.net_worth - state.dire.net_worth
    if abs(lead) >= WIN_NETWORTH_LEAD:
        state.game_over = True
        state.winner = "radiant" if lead > 0 else "dire"


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
    args = parser.parse_args(argv)

    timeline, state = simulate(args.seed)
    if args.timeline:
        print(json.dumps(timeline.to_list(), indent=2))
    print(
        f"seed {args.seed}: {state.winner} wins at "
        f"{state.t // 60}:{state.t % 60:02d} ({len(timeline.events)} events)"
    )


if __name__ == "__main__":
    main()
