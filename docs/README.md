# Docs hub

The knowledge layer between [`AGENTS.md`](../AGENTS.md) (always loaded, routes
you to a surface) and the code itself.

Use it when:

- `AGENTS.md` told you *where* to go, but you need the behavior context first.
- You want invariants, data flow, or measured numbers before editing.

## Read order

1. [`../SYSTEM-DESIGN.md`](../SYSTEM-DESIGN.md) — the map: every component, how
   data flows, design decisions, Stage 0–8 status.
2. [`05-progress.md`](05-progress.md) — where things actually stand right now,
   and what's next.
3. [`01-implementation-pipeline.md`](01-implementation-pipeline.md) — the stages
   with concrete exit criteria.
4. [`02-data-model.md`](02-data-model.md) — schemas, timeline event payloads,
   feature tables, on-disk layout.
5. [`03-ingestion-spec.md`](03-ingestion-spec.md) — OpenDota → snapshots and the
   match corpus; dedup, resumability, parsed details.
6. [`04-ml-engine.md`](04-ml-engine.md) — win-probability models (incl.
   per-bracket), hero ratings, and the four-metric calibration harness.

## Topical companions

Read when working on that surface:

- [`decisions/0001-rust-for-engine.md`](decisions/0001-rust-for-engine.md) — why
  the engine is Python now and Rust later.
- [`decisions/0002-macro-sim-fidelity.md`](decisions/0002-macro-sim-fidelity.md)
  — why the sim is macro (30s ticks), not unit-level.
- [`runbooks/calibration.md`](runbooks/calibration.md) — how to check the engine
  still matches reality, and what to do when it doesn't.
- [`runbooks/patch-day.md`](runbooks/patch-day.md) — what to do when Dota ships a
  new patch.

## Principle

Keep `AGENTS.md` concise routing.
Keep `docs/` explanatory and query-friendly.
Keep code as the final source of truth.
