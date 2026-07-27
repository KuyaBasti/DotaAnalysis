# Progress log

Living record of what's shipped. Newest first. Keep it updated as verticals land
(one entry per merged PR or coherent chunk). Metrics are the last measured values;
re-run `dm-calibrate --sample 2000` after engine changes.

## Where things stand

- **58 PRs merged.** The core loop works end-to-end: **draft → predict → simulate
  → watch → analyze**, all of it **at the rank bracket you play**, and every
  realism issue from the audits is closed.
- **Engine:** a full, watchable ranked game — real (Divine-calibrated) economy,
  laning, teamfights with named casualties + K/D/A, Roshan, XP/levels, two-sided
  laned objectives → Ancient, and moving hero positions.
- **Calibration (n=2000):** duration exact-to-median (sim ≈ 35.5m vs real 35.5m),
  economy within ±1% of parsed real gold at min 10/20, win edge ≥ baseline.
  Per-hero win-rate `r` ≈ 0.56 is the open realism target (0.8 goal).
- **Data:** 127k matches banked / **59.4k ranked** in the feature store (every
  bracket viable to train on), plus a growing sample of
  parsed details (gold curves + purchase logs) in `data/details/`.
- **Not shipped.** Personal project; no deploy.

## Stage status

| Stage | Status |
|---|---|
| 0 System design | ✅ done |
| 1 Feasibility | ✅ done |
| 2 Data foundation | ✅ done |
| 3 Engine core | ✅ Python engine complete · ⬜ Rust port |
| 4 Orchestrator/API | 🟡 API + simulate + **bracket-aware Monte Carlo** · ⬜ batch job queue |
| 5 Frontend | ✅ done (Draft Studio + Match Viewer playback) |
| 6 ML & calibration | 🟡 four-metric harness + **per-bracket models** · ⬜ fight-outcome model |
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

**Documentation refresh.** README, SYSTEM-DESIGN, the `docs/` suite, the root agent file,
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

**Monte-Carlo analysis (Stage 4).** `prototype/montecarlo.py` (`dm-montecarlo`)
runs a draft N times → win-probability distribution + duration spread + a
representative game (majority-side winner nearest the median), exported so it's
watchable. Served at `POST /sims/aggregate`; Draft Studio's **📊 Analyze (200
sims)** button shows the win bar, a duration histogram, and a "watch a
representative game" jump into the viewer. 200 sims ≈ 1.3s — fast enough on
demand, so the Rust port stays a future optimization.

**Per-rank models (Stage 6).** `features/brackets.py` defines three bands
(Herald–Crusader / Archon–Legend / Ancient+ — eight medals are too thin to train
on, three each clear ~9k matches). Hero win rates, strength ratings, and the
win-prob model are all bracket-aware; `dm-train-winprob` trains one model per
band plus the blend. **Every bracket model beats the blend, and the ordering is
the finding:** AUC 0.663 low / 0.650 mid / 0.584 high vs 0.614 blended — *draft
matters most at low ranks and least at high ranks*, which finally explains the
long-standing "draft explains less at higher skill" ceiling (it was two
different games averaged together). Real hero swings back it up: Sniper +9.5
points low-vs-high, Clockwerk −12.8. The API serves any bracket
(`POST /analysis/draft {bracket}`, falling back to blended) and Draft Studio has
a rank selector. Honest negative result recorded: bracket-matched *ratings* did
not improve the sim's win accuracy, so the sim's default stays blended
(`--bracket` is opt-in).

**Agent-facing docs restructure.** The always-loaded root file is now
`AGENTS.md` (portable to non-Claude agents; `CLAUDE.md` is a one-line
`@AGENTS.md` alias), and it leads with a **routing table** — Area → Location —
so an agent learns where code lives without searching. Added
[`docs/README.md`](README.md), a hub with an explicit read order plus topical
companions, which finally surfaces `decisions/` and `runbooks/`. Principle:
root = concise routing, `docs/` = explanation, code = final source of truth.

**Bracket-aware Monte Carlo.** Wired the two halves together — Monte Carlo and
the per-bracket models shipped days apart without talking. It began as a bug:
Draft Studio already sent `bracket` with every Analyze request and the API
dropped it (`AggregateRequest` had no such field, the runner never passed
`--bracket`), so the rank selector moved the win% but every 200-sim run used
blended ratings. Now the bracket reaches the engine, the panel names the rank it
analyzed, and `bracket` is part of the `SimAggregate` contract. The payoff: one
hero swapped per side swings **99.5% (Herald–Crusader) → 60.0% (Ancient+)**,
where blended says 81% — wrong at both ends. This also qualified an earlier
negative result: bracket ratings don't help *win accuracy*, but they move the
*distribution* a lot, which is what analysis actually reads. Caveat recorded in
[04-ml-engine.md](04-ml-engine.md): extreme drafts saturate at 100%, so the tails
over-amplify.

## Next — the additive roadmap

The engine's realism work is done; what's left adds new capability (nothing is a
fix). See [../SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md) for the map.

1. **Coach Lab** (Stage 7) — turn watchable sims + per-bracket analysis into
   teaching (why a draft loses, timing windows, item advice — `dm-builds` data is
   ready, and the bracket models give advice that fits the player's rank).
2. **Fight-outcome model** (Stage 6) — learn the fight resolver from parsed
   teamfight data instead of the analytic logistic.
3. **Soften rating amplification at the tails** — extreme drafts saturate at
   100%; `_STRENGTH_TO_NETWORTH` turns a large rating edge into ~28k
   gold-equivalent. Direction is right, magnitude isn't.
4. **Rust engine port** (Stage 3) — speed for large batch Monte-Carlo runs.
5. **Batch job queue** (Stage 4) — enqueue long runs rather than run inline.
