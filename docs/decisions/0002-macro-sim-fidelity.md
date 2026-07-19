# ADR 0002 — Macro-sim fidelity

**Status:** accepted

## Context

How detailed should the simulation be? Options span a spectrum:

- **Micro** — unit positions, projectiles, ability interactions, pathfinding.
  Faithful, enormous to build, and mostly invisible in a watch-from-the-bench view.
- **Macro** — model the *economy and beats* (gold/XP, laning, fights, objectives,
  Roshan) on coarse ticks, and render them as a watchable timeline.

## Decision

Simulate at the **macro** level: a discrete-event loop on **30-second ticks**,
tracking per-hero net worth / XP / levels / K/D/A and team objectives, resolving
fights analytically (a logistic on the net-worth + strength gap).

## Consequences

- A **complete coarse loop beats a perfect fragment** — you can watch a whole game
  from minute 0 to the Ancient, which is the entire point.
- Fidelity is pursued through **calibration against real data** (gold curves, game
  length, hero win-rate spread), not through mechanical detail. "Believable" is
  measured, not simulated bottom-up.
- Some things are **presentational approximations** layered on top of the macro
  state — hero map positions, which lane a tower falls in, who gets the kill.
  These are deliberately rng-free so they can't affect outcomes.
- A micro layer could be added later under the same timeline contract if a use case
  ever demands it; nothing here precludes it.
