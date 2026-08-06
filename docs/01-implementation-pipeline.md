# Implementation pipeline

The build runs in stages. Each stage has concrete tasks and an **exit criterion**
— an observable check that says "done," not a vibe. Do the stages roughly in
order; later stages assume earlier ones hold. Current status lives in
[05-progress.md](05-progress.md); the high-level map is in
[../SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md).

---

## Stage 0 — System design ✅

**Goal:** a written map before code.

- System-design doc + end-to-end flowchart.
- JSON Schema contracts stubbed in `schemas/`.
- Monorepo tree scaffolded.

**Exit criterion:** a new contributor can read `SYSTEM-DESIGN.md` and name every
component and how data flows between them. ✅

---

## Stage 1 — Feasibility spikes ✅

**Goal:** de-risk the core bet before building on it — does the draft alone carry
signal?

- Train a draft→win model on real matches.

**Exit criterion:** the draft→win model beats a coin flip on held-out real
matches (AUC > 0.5 with margin). ✅ — logistic regression on hero presence
(+1 radiant / −1 dire / 0 absent) clears it.

---

## Stage 2 — Data foundation ✅

**Goal:** a reproducible, self-growing supply of clean data.

- `dm-ingest`: OpenDota constants → validated patch snapshot.
- `dm-harvest`: bank ranked matches, resumable, on a cron.
- `dm-backfill`: parsed match details (gold curves, purchase logs) for a sample.

**Exit criteria (all must hold):**

- **Re-ingest is reproducible** — running `dm-ingest --patch-id X` twice produces
  a byte-identical snapshot (the snapshot validates against
  `schemas/snapshot.schema.json`). ✅
- **Harvest is idempotent/resumable** — re-running `dm-harvest` banks **zero**
  already-stored matches (files keyed by `match_id`); an interrupted run resumes
  without gaps. ✅
- **Only clean, in-scope rows survive** — feature extraction keeps ranked All
  Draft only and drops unfinished games and non-5v5 records. ✅
- **The corpus grows unattended** — the cron accrues matches without manual
  intervention. ✅ (100k+ banked.)

---

## Stage 3 — Engine core ✅ (Python) · ⬜ (Rust port)

**Goal:** a deterministic engine that turns a draft into a full, watchable,
*believable* match timeline.

- Discrete-event loop (30s ticks), single seeded RNG.
- Per-hero economy (by farm position, time-ramped), laning, analytic fight
  resolver, Roshan, XP/levels, item timings (real builds at calibrated net
  worth), two-sided objectives (towers → Ancient), hero positions, K/D/A.

**Exit criteria:**

- **Determinism** — same draft + same seed ⇒ a byte-identical timeline
  (golden-replay test). ✅
- **A real game** — every match ends with the Ancient falling (a late-game push
  ramp guarantees it, even at the time cap — never an abstract decision); no
  impossible states. ✅
- **Presentational purity** — positions and K/D/A consume no RNG, so adding them
  cannot change any outcome (asserted in tests). ✅
- **Calibrated** — against the real corpus, sim game-duration is within ±3 min of
  real (currently exact on the median) and team net worth is within ±5% of parsed
  real curves at the 10- and 20-minute checkpoints (currently ±1%). ✅
- ⬜ **Rust port** — the DES core reimplemented in `engine/`, timeline
  byte-compatible with the Python reference. *Not started.*

---

## Stage 4 — Orchestrator / API 🟡 (Monte Carlo ✅; job queue ⬜)

**Goal:** serve data and run sims on demand.

- Read-only API: snapshots, sims, draft eval. ✅
- `POST /sims`: simulate a user's draft on demand (spawns the engine). ✅
- `POST /sims/aggregate`: **Monte Carlo** — run a draft N times → win-probability
  distribution, not one game (`prototype/montecarlo.py`, `dm-montecarlo`). ✅
- `POST /analysis/explain`: the win probability broken down per hero (Stage 7's
  first slice; see below). ✅
- ⬜ Job queue: batch Monte Carlo at scale (only needed beyond on-demand).

**Exit criteria:**

- **Simulate-a-draft round-trips** — `POST /sims {radiant, dire}` validates the
  draft, runs the engine, and returns a sim id that `GET /sims/:id` can fetch. ✅
- **Monte Carlo served** — `POST /sims/aggregate` runs N sims and returns win
  rate + duration distribution + a representative sim id (watchable). ✅
- ⬜ **Job queue** — long batch runs enqueued rather than run inline. *Not needed
  yet (200 sims ≈ 1.3s on demand).*

---

## Stage 5 — Frontend ✅

**Goal:** draft a match and watch it.

- Patch Explorer, Draft Studio (attribute-grouped picker, live win%, Simulate
  button), Match Viewer.
- Playback: game clock (play/pause/scrub/speed), live scoreboard (net worth,
  levels, K/D/A), minimap with structures falling and heroes moving, win-prob
  strip, narrated match feed.

**Exit criterion:** a user picks 5v5 in the browser, clicks Simulate, and watches
that match play minute-by-minute in the Match Viewer — no terminal, no manual
steps. ✅

---

## Stage 6 — ML & calibration 🟡

**Goal:** ground the engine in data and keep it honest.

- Feature store (Parquet + DuckDB), win-prob model, hero strength ratings.
- Calibration harness scoring win accuracy, per-hero win-rate correlation, game
  duration, and economy checkpoints.
- **Per-rank models**: three rank bands (`features/brackets.py`); bracket-aware
  win rates, ratings, and one win-prob model per band, selectable end to end.
- **Hero interactions** (`models/win_probability/pairs.py`): blended synergy and
  counter terms layered onto the per-bracket hero weights, so a hero's value
  depends on the draft around it.
- ⬜ Richer models: fight-outcome from parsed details; gradient boosting once
  data supports it.

**Exit criteria:**

- **Four-metric scoreboard** — `dm-calibrate` reports win/realism/duration/economy
  in one run, validated on n ≥ 2000 drafts. ✅
- **Realism gates** — duration within ±3 min and economy within ±5% (both met).
  Per-hero win-rate correlation is tracked as the open research target. 🟡
- **Per-rank models** — every band trains on enough matches (≥ ~9k), each
  bracket model **beats the blended one** on held-out AUC (0.663 / 0.650 / 0.584
  vs 0.614), and a bracket is selectable from Draft Studio through to the served
  win%. ✅
- **Hero interactions** — synergy/counter terms improve held-out AUC at every
  bracket (+0.011 to +0.014) **and** Brier, once the AUC-tuned weighting is
  rescaled back onto the log-odds scale. ✅

---

## Stage 7 — Coach Lab / education 🟡

**Goal:** turn watchable sims into teaching — "why is this draft losing?", timing
windows, per-bracket advice.

**Exit criterion:** a player can pick their rank, draft a matchup, and get an
explanation they can act on — not just a number.

- ✅ **Why a draft wins** — `POST /analysis/explain` breaks the win probability
  into per-hero swings (percentage points that hero adds to their own side
  versus an average pick in the slot), drawn under the win bar in Draft Studio.
  Exact rather than heuristic: the model is linear in log-odds, so dropping a
  hero's weight is a real counterfactual. Reading the same draft at two ranks is
  the teaching moment — Sniper +17.5pp at Herald–Crusader, +7.2pp at Ancient+.
- ⬜ **Timing windows** — when a draft is strongest/weakest, from the
  Monte-Carlo runs plus `dm-builds` item spikes.
- ⬜ **Draft suggestions** — rank the next pick against the current partial
  draft at the player's bracket. Unblocked by the pair terms in Stage 6: while the
  model was purely additive this would have ranked the same heroes whatever you
  had already drafted.

A swing now covers the hero *and their fit with the draft* — synergy and counter
terms landed in the model, so the earlier caveat that it "scores heroes
individually" no longer applies. What it still cannot see is anything outside
hero identity and hero pairs: lanes, roles, and timings are not features.

---

## Stage 8 — Beta & launch ⬜

**Goal:** deploy for real users.

**Exit criterion:** *(deliberately unset — this is a personal project with no ship
date; do not deploy until the owner decides it's ready.)*
