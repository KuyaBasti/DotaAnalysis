---
name: dm
description: >-
  DraftMaster's command center — one-word workflows for the project's
  runbooks and multi-agent reviews. Use when the owner says /dm <mode>, or
  names a mode: health check, meta refresh, patch day, adversarial review,
  measurement spike, believability, docs sweep.
argument-hint: "[health | refresh | patch-day <ver> | review | spike <question> | believability | docs-sweep]"
user_invocable: true
---

# /dm — DraftMaster router

Route on the first argument. Every mode obeys the house rules in AGENTS.md,
plus two owner rules that override everything:

1. **Verify-before-merge.** Build on a branch, tests green, open localhost
   (or show the artifacts when nothing is visual), then STOP. Nothing is
   PR'd or merged until the owner explicitly says so.
2. **Lab vs main.** Engine/UI experiments live on `experimental`, pushed
   only to the `lab` remote (private). `main`/`origin` get calibrated,
   reviewed verticals only.

Commit style: incremental, one coherent change each, **no AI attribution
lines** (no Co-Authored-By, no "Generated with" — AGENTS.md rule).

---

## health

The "what is the next step" sweep. Run and report in one message:

```bash
tail -3 data/harvest.log && tail -3 data/backfill.log
ls data/matches/ | wc -l && ls data/details/*.json | wc -l
```

- 7.41-era patch share: count details with `start_time` past the current
  patch's release date (see [docs/runbooks/data-collection.md](../../../docs/runbooks/data-collection.md)).
- Model freshness: `ls -la data/models/ data/features/*.parquet` — if the
  parquet mtime predates the current patch by weeks, recommend `refresh`.
- Servers: `curl -s localhost:3000/health` and `localhost:5273/` — restart
  via `api && npm run dev` (background) and the `web` launch config if down.
- Open PRs: `gh pr list`. Branch: `git branch --show-current`.

Report: corpus, cron health, model freshness, servers, open PRs, and the
one recommended next action with its reason.

## refresh

The meta refresh ([docs/runbooks/calibration.md](../../../docs/runbooks/calibration.md)).
Preconditions: on `main`, clean tree, current-patch details corpus past
~1,500. Then, in order (background the whole chain — 20-40 min):

```bash
dm-features && dm-train-winprob && dm-trajectories \
  && dm-calibrate --sample 2000 && dm-fit-fightscale
```

Interpretation discipline:
- Rebuilding features MOVES the real-side targets — the calibrate run is a
  **new baseline**, not a comparison against the old one. Report absolute
  gates: duration ±3 min, economy ±5%, and record the new Brier as baseline.
- Brier is the only proper scoring rule; accuracy and per-hero r are
  diagnostics that reward over-confidence (AGENTS.md).
- `dm-fit-fightscale` reports drift against the shipped constants. Material
  drift = propose a deliberate retune (constants AND the two-point pin in
  `test_fights.py` together) — a code change that stops at the merge gate.
- Restart the API afterwards (it caches models/sims at startup).
- Delegate gate interpretation to the **calibration-judge** agent when the
  numbers are surprising.

## patch-day <version>

New patch released. In order:

1. `dm-ingest --patch-id <version>` — snapshot; confirm hero/item counts.
2. Bump `DEFAULT_PATCH_ID` in `pipeline/dm_pipeline/config.py` and
   `_DEMO_SCENARIO.patch_id` in `prototype/sim_loop.py` — after verifying
   every demo hero key exists in the new snapshot.
3. Regenerate demo sims (seeds 7, 42, 99, 123, 2329308, 543032472):
   `python -m dm_pipeline.prototype.sim_loop --seed <s> --export`
4. Restart the API; verify `/patches`, `/sims`, `/analysis/draft` serve the
   new patch end to end on localhost.
5. This is a code change: branch, tests, owner inspection, merge gate.
6. Models/trajectories/fight-scale refresh LATER, once the corpus turns
   over (~1,500+ new-patch details) — that is the `refresh` mode.

## review

The three-lens adversarial review that has caught real defects three times
(stale mirrored constants, gate-shaving commit messages, optimizer-blind
tests). Launch a Workflow: three critics in parallel over the current
branch's diff —

- **correctness** (invariants, consumers of changed constants incl. web/
  mirrors, edge cases, comment accuracy),
- **statistics/leakage** (delegate persona: **leakage-auditor** — re-derive
  every claimed number independently; mutation-test guard tests),
- **gate-honesty** (were tests/fixtures/bounds adjusted so a favored change
  passes? do commit messages disclose red tests plainly?),

then adversarially VERIFY each finding (default-refute, independent
reproduction) before acting. Fix confirmed findings; report rejected ones
with reasons.

## spike <question>

Measure before building (the discipline that turned the ML fight model into
two constants). Protocol:

1. Name the leakage traps BEFORE extraction (see leakage-auditor's list).
2. Scripts in the session scratchpad; extraction → fit → held-out scoring,
   split by match, never by observation.
3. Attack your own result: peel dominant signals, check bucket stability,
   significance clustered by match, hyperparameters off grid edges.
4. Report verdict + effect sizes + the honest caveats. Build NOTHING until
   the owner approves the follow-on.

## believability

Lab-only (`experimental` branch). `dm-believability --real 2000 --sims 2000`
— the sim's Turing test. Report AUC, believability score, and the ranked
tells table; peel dominant tell groups to expose the layers beneath.
Re-run after every lab engine experiment; the delta is the experiment's
grade. Terminal-only — the owner ruled no metrics UI in the app.

## docs-sweep

After a vertical merges (own PR, always — never mixed with code):

- Status lives in FOUR places; update all: README's Status section,
  SYSTEM-DESIGN's stage table, docs/01's stage bullets, docs/05's header
  count + stage table.
- docs/05 gets an arc entry (newest-first, **bold lead.** prose style);
  historical entries are immutable — never rewrite them to current truth.
- PR count convention: the number of PRs merged at the time of writing.
- Sweep topical docs the vertical touched (docs/02/03/04, runbooks).
- Delegate to the **docs-sweeper** agent for the grep-all-surfaces pass.
