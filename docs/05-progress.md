# Progress log

Living record of what's shipped. Newest first. Keep it updated as verticals land
(one entry per merged PR or coherent chunk). Metrics are the last measured values;
re-run `dm-calibrate --sample 2000` after engine changes.

## Where things stand

- **46 PRs merged.** The core loop works end-to-end: **draft → predict → simulate
  → watch**.
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
filled schemas — brought up to the reality above (this stage).

## Next (from the latest audit)

Minor refinements, no longer structural:

1. **60-minute games end by decision, not a throne** — raise/remove the time cap
   or add a late-game surge so someone takes the Ancient.
2. **First bloods skew very early** (many in minute 1) — ramp fight chance in from
   a lower early value.
3. **Item-timing beats** — the last missing feed vocabulary; parsed
   `purchase_log` data is already banked in `data/details/`.

Larger roadmap (Stages 4/6/7): Monte-Carlo orchestrator, per-rank models, Rust
engine port, Coach Lab. See [../SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md).
