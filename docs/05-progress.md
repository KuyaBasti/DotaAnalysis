# Progress log

Living record of what's shipped. Newest first. Keep it updated as verticals land
(one entry per merged PR or coherent chunk). Metrics are the last measured values;
re-run `dm-calibrate --sample 2000` after engine changes.

## Where things stand

- **50 PRs merged.** The core loop works end-to-end: **draft → predict → simulate
  → watch**, and every realism issue from the audits is closed.
- **Engine:** a full, watchable ranked game — real (Divine-calibrated) economy,
  laning, teamfights with named casualties + K/D/A, Roshan, XP/levels, two-sided
  laned objectives → Ancient, and moving hero positions.
- **Calibration (n=2000):** duration exact-to-median (sim ≈ 35.5m vs real 35.5m),
  economy within ±1% of parsed real gold at min 10/20, win edge ≥ baseline.
  Per-hero win-rate `r` ≈ 0.56 is the open realism target (0.8 goal).
- **Data:** 100k+ ranked matches banked (all brackets), plus a growing sample of
  parsed details (gold curves + purchase logs) in `data/details/`.
- **Not shipped.** Personal project; no deploy.

## Stage status

| Stage | Status |
|---|---|
| 0 System design | ✅ done |
| 1 Feasibility | ✅ done |
| 2 Data foundation | ✅ done |
| 3 Engine core | ✅ Python engine complete · ⬜ Rust port |
| 4 Orchestrator/API | 🟡 API + simulate-a-draft · ⬜ Monte Carlo |
| 5 Frontend | ✅ done (Draft Studio + Match Viewer playback) |
| 6 ML & calibration | 🟡 four-metric harness · ⬜ per-rank / fight-outcome models |
| 7 Coach Lab | ⬜ not started |
| 8 Beta & launch | ⬜ not started |

## The arc so far (grouped)

**Foundation (Stages 0–2).** Monorepo scaffolding; snapshot schema + `dm-ingest`;
read-only Patch Data API; Patch Explorer web page. Match harvester (`dm-harvest`),
resumable, on a 3-hour cron. Feature store (`dm-features`, Parquet + DuckDB).

**First ML + the second tracer bullet.** Draft→win logistic model
(`dm-train-winprob`); coefficients served natively by the API (`POST
/analysis/draft`); Draft Studio's live win% bar. Sim results exported and served
(`GET /sims`); first Match Viewer (static summary + net-worth graph + log).

**Engine into a real game.** Deterministic DES (economy, laning, analytic fights);
objectives model (towers → Ancient as the win condition); narrative beats (named
fight casualties, Roshan). Calibration harness with win + realism (per-hero `r`,
duration) scoreboards.

**The watch-the-game vertical (north star).** Playback Viewer: game clock
(play/pause/scrub/speed), live scoreboard, net-worth graph revealed to the
playhead, win-probability strip, narrated match feed. Sim picker. Comeback gold.
Hero scoreboard with levels then K/D/A. **2D minimap** with structures falling and
**ten hero dots moving** (laning → push fronts → fight clusters).

**Grounding in reality.** Ranked-only data policy; re-ingest to the current patch
(7.41d). **Real economy** — backfilled parsed Divine games (`dm-backfill`) and
recalibrated every gold constant to real per-minute curves (economy metric added
to `dm-calibrate`). Objective pacing (regroup cooldown + high-ground toughness) so
stomps can't end at 16:00; duration distribution matched to real.

**Draft → watch, and audit-driven polish.** `POST /sims` + Draft Studio's
"Simulate this draft" button → watch your own match; humanized sim labels. Hero
picker grouped **STR / AGI / INT / Universal**. Then a 12-random-sim audit drove
five fixes: watched sims now load hero ratings; real kill volume + core-weighted
K/D/A; losing teams take towers (two-sided pressure); fight XP for real late-game
levels.

**Documentation refresh.** README, SYSTEM-DESIGN, the `docs/` suite, `CLAUDE.md`,
filled schemas — brought up to reality.

**Item timings.** `dm-builds` extracts real per-hero item builds and
net-worth completion thresholds from parsed purchase logs; the engine narrates
them (`item` events) as heroes finish their real builds at calibrated net worth,
shown in the match feed and on the scoreboard. Rng-free (items are narrative).

**Audit close-out.** The last refinements from the 12-random-sim audits:
**always a throne** — a late-game push ramp (plus a cap safety net) so every
game ends with the Ancient falling, never an abstract time-cap decision;
**first-blood timing** — the data overturned the hunch (real Divine first bloods
are *very* early: median ~0.9 min, 60% inside the first minute), so the sim was
front-loaded to match. No known realism defects remain.

## Next — the additive roadmap

The engine's realism work is done; what's left adds new capability (nothing is a
fix). See [../SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md) for the map.

1. **Monte-Carlo orchestrator** (Stage 4) — run a draft N times → a
   win-probability distribution + duration spread, not one game. Most of the
   compute already exists (`calibrate/run_corpus.py` runs N sims per draft); the
   `SimAggregate` schema is defined. The biggest capability jump for the least new
   machinery.
2. **Per-rank models** (Stage 6) — train the win-prob model + hero ratings by rank
   tier so players pick their bracket (the reason all-rank data is retained).
3. **Rust engine port** (Stage 3) — speed for large Monte-Carlo runs.
4. **Coach Lab** (Stage 7) — turn watchable sims into teaching.
