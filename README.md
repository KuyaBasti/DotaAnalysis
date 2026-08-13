# DraftMaster

**Watch a Dota 2 match you drafted play out, minute by minute.** DraftMaster is a
Football-Manager-style match simulator: pick two teams, and a deterministic
engine — grounded in real ranked match data — generates a full game you can
watch unfold (heroes moving on the map, gold and levels ticking, teamfights,
Roshan, towers, the Ancient). Not a replay of a real game — a *generated* one.

> **North star:** the watch-from-the-bench experience — see the whole game as it
> happens, like being benched in NBA 2K MyCareer. That experience exists today
> (the Match Viewer); everything else serves making it believable.

The engine is validated against a live corpus of **127k+ banked matches** and
sits within ~1% of real Divine-bracket gold curves, exact on median game length.
See [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) for the full map and
[docs/05-progress.md](docs/05-progress.md) for where things stand.

## Monorepo layout

| Dir | Lang | What | Status |
|-----|------|------|--------|
| `pipeline/` | Python | Patch ingestion, match harvesting, feature store, ML, **and the prototype simulation engine** | ✅ built |
| `api/` | TypeScript (Fastify) | Read-only data API + draft evaluation + simulate-a-draft | ✅ built |
| `web/` | React + Vite | Draft Studio, Match Viewer (playback), Patch Explorer | ✅ built |
| `schemas/` | JSON Schema | Cross-language data contracts; analysis responses CI-enforced | ✅ built |
| `engine/` | Rust | The DES core, ported from Python for speed | ⬜ planned |
| `infra/` | — | Deploy configs, dev scripts | ⬜ planned |
| `docs/` | — | System design, data model, specs, progress log | ✅ this refresh |

The simulation engine lives in `pipeline/dm_pipeline/prototype/` as a Python
discrete-event simulation (DES). The `engine/` Rust port is **planned, not
started** — the Python prototype is the working engine today.

## Quickstart

Prereqs: Python 3.11+, Node 20+.

```bash
# 1. Pipeline (Python) — ingestion, ML, and the simulation engine
python -m venv .venv && source .venv/bin/activate
pip install -e pipeline                      # installs the dm-* CLIs

dm-ingest --patch-id 7.41d                   # build a patch snapshot from OpenDota
python -m dm_pipeline.prototype.sim_loop --seed 42 --export   # simulate one match

PYTHONPATH=pipeline .venv/bin/python -m pytest pipeline/tests/   # run pipeline tests

# 2. API (TypeScript) — serves snapshots, sims, and draft eval on :3000
cd api && npm install && npm run dev

# 3. Web (React) — Draft Studio + Match Viewer on :5173 (proxies to the API)
cd web && npm install && npm run dev
```

Then open <http://localhost:5173>, go to **Draft Studio**, pick five heroes per
side, choose your **rank bracket**, and either **▶ Simulate this draft** (watch
one game in the **Match Viewer**) or **📊 Analyze (200 sims)** — a Monte-Carlo
win-probability distribution + duration spread, with a representative game to
watch.

Under the win bar you get **why** and **what next**. *Why* is a per-hero
breakdown of who is moving the draft, in percentage points versus an average
pick in that slot — move the rank selector and Sniper goes from **+17.5 points**
in Herald–Crusader to **+7.2** at Ancient+, while Clockwerk goes **−5.2 → +2.0**.
*What next* ranks every hero you haven't drafted, either by raw strength or by
**fit** — how well they pair with, and counter, the heroes already on the board.
Click one to draft them. And once both sides have five, **farm timing** draws
each lineup's gold-engine curve from parsed real games and says who should
close early — farm timing, not win timing, and the panel says so.

### The pipeline CLIs (`pip install -e pipeline`)

| Command | What it does |
|---|---|
| `dm-ingest --patch-id <v>` | OpenDota constants → validated patch snapshot |
| `dm-harvest --max N` | bank recent ranked matches to `data/matches/` (resumable) |
| `dm-backfill --max N` | fetch parsed match details (gold curves, purchase logs); on a cron |
| `dm-features` | banked matches → Parquet feature tables + hero win rates |
| `dm-builds` | parsed purchase logs → per-hero item builds + completion thresholds |
| `dm-trajectories` | parsed gold curves → per-hero farm-timing signatures (coverage-gated) |
| `dm-montecarlo --radiant … --dire …` | run a draft N times → win/duration distribution (JSON) |
| `dm-train-winprob` | train the draft→win model — one per rank bracket + blended |
| `dm-calibrate --sample N` | score the sim against the real corpus (win / realism / economy) |

Generated artifacts land in `data/` (git-ignored). See
[docs/03-ingestion-spec.md](docs/03-ingestion-spec.md) and
[docs/04-ml-engine.md](docs/04-ml-engine.md) for details.

## Documentation

- [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) — the full map, design decisions, and Stage 0–8 build plan
- [docs/01-implementation-pipeline.md](docs/01-implementation-pipeline.md) — stages with concrete exit criteria
- [docs/02-data-model.md](docs/02-data-model.md) — schemas: snapshots, timeline events, scenarios, feature tables
- [docs/03-ingestion-spec.md](docs/03-ingestion-spec.md) — OpenDota ingestion, harvesting, dedup, details backfill
- [docs/04-ml-engine.md](docs/04-ml-engine.md) — win-prob model, hero ratings, and the calibration harness
- [docs/05-progress.md](docs/05-progress.md) — living log of what's shipped
- [AGENTS.md](AGENTS.md) — always-loaded routing + conventions (`CLAUDE.md` aliases it)
- [docs/README.md](docs/README.md) — docs hub: read order and topical companions

## Status

A working alpha, developed as a personal project — **not shipped or deployed**.
The core loop (draft → predict → simulate → watch → analyze → understand → act)
works end-to-end, including Monte-Carlo matchup analysis, per-rank models, hero
synergy/counter terms, the per-hero draft explanation, and next-pick
suggestions, and farm-timing windows — **Coach Lab is complete**. The remaining
roadmap (the fight-outcome model, the Rust engine, and a batch job queue) is
tracked in
[SYSTEM-DESIGN.md](SYSTEM-DESIGN.md).
