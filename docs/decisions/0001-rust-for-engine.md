# ADR 0001 — Rust for the engine (eventually)

**Status:** accepted (planned; the Python prototype is the engine today)

## Context

The simulation engine turns a draft into a full match timeline. Two forces pull in
opposite directions:

- It sits next to the data and ML that feed it (hero ratings, the win-prob prior,
  the calibration corpus) — all Python.
- The end goal includes **Monte Carlo**: running one draft thousands of times for a
  win-probability *distribution*, not a single game. That wants speed.

## Decision

Build the engine in **Python first**, port the hot core to **Rust later**.

- The Python DES (`pipeline/dm_pipeline/prototype/`) is the reference
  implementation and stays the source of truth for behaviour.
- The `engine/` Rust crate is **planned, not started**. When it lands it must
  produce a **byte-compatible timeline** for a given scenario + seed, verified
  against the Python reference (the determinism contract makes this checkable).

## Consequences

- Fastest path to a correct, *calibrated* loop — the hard part is fidelity, not
  throughput, and that's cheaper to iterate in Python.
- A single seeded-RNG, event-timeline contract is the seam the port slots into;
  keeping presentational state rng-free protects it.
- Until the port, Monte Carlo at scale is out of reach — acceptable for an alpha
  that watches one game at a time.
