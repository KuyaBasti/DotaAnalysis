# DraftMaster

A Dota 2 match simulator you can watch: draft two teams, and a deterministic
Python engine — calibrated against real ranked matches — generates a full game
that plays out minute-by-minute in the browser.

## Start Here

[docs/README.md](docs/README.md) routes to the behavior and architecture
documentation. Read the relevant document before changing that surface; code
remains the final source of truth.

| Area | Location |
| --- | --- |
| Simulation engine (30s-tick DES) | `pipeline/dm_pipeline/prototype/sim_loop.py` |
| Monte-Carlo aggregation | `pipeline/dm_pipeline/prototype/montecarlo.py` |
| Ingestion (patches, matches, details) | `pipeline/dm_pipeline/ingest/`, `harvest/` |
| Feature store, ratings, brackets | `pipeline/dm_pipeline/features/` |
| Win-probability model | `pipeline/dm_pipeline/models/win_probability/` |
| Calibration harness | `pipeline/dm_pipeline/calibrate/` |
| API routes | `api/src/routes/` (+ `simRunner.ts`, `winProbModel.ts`) |
| Draft Studio (pick, predict, analyze) | `web/src/pages/DraftStudio/` |
| Match Viewer (playback, minimap) | `web/src/pages/MatchViewer/` |
| Data contracts | `schemas/*.json` |
| Generated artifacts (git-ignored) | `data/` |
| Tests | `pipeline/tests/`, `api/tests/`, `web/src/**/*.test.ts` |

## Workflow

- **One vertical per branch → PR → merge to `main`.** Branch names like
  `engine/objective-pacing`, `web/attr-groups`, `docs/refresh`.
- **Incremental commits.** Smallest coherent change per commit — usually a single
  file. Push as you go. Don't batch a dozen files into one commit.
- **No AI attribution in commits or PRs.** No `Co-Authored-By`, no "Generated
  with…" trailer. Just the change.
- **Docs ship in their own PR — always.** A code PR contains code and tests,
  nothing else. When the vertical merges, branch `docs/<what>` and update the
  README / SYSTEM-DESIGN / `docs/*` / this file there. Never mix the two.
- **Update the progress log.** When a vertical lands, add it to
  [docs/05-progress.md](docs/05-progress.md) — in that docs PR.
- **Follow the stages in order** (docs/01). Later stages assume earlier exit
  criteria hold.

## No rush — this is a personal project

- **Do not deploy or "ship."** No Railway/prod pushes, no "Review Alpha," no
  release steps unless the owner explicitly asks. Quality over speed.
- Stage 8 (launch) is deliberately unset. Build until it's genuinely ready as the
  owner wants it, not on a schedule.

## Engine discipline (the load-bearing rules)

- **Determinism is sacred.** Same scenario + same seed ⇒ byte-identical timeline.
  All randomness goes through the single `SeededRng`
  (`prototype/rng.py`) — nothing else may call into randomness. There's a
  golden-replay test; keep it green.
- **Presentational state is rng-free.** Positions, K/D/A, and anything that only
  affects how a match is *shown* must be pure functions of game state, so adding
  them cannot change an outcome. Tests assert this — preserve it.
- **Calibrate every engine change.** Run `dm-calibrate --sample 2000`: duration
  within ±3 min, economy within ±5% of real (currently ±1%), and **Brier at or
  below baseline**. The engine is tuned to **reality**, not to intuition —
  measure, don't guess.
- **Win accuracy and per-hero `r` are not gates — they reward over-confidence.**
  Hero ratings are derived from real win rates, so a sim that merely ranks by
  rating scores well on both. Cranking `_STRENGTH_TO_NETWORTH` to 64,000 gives
  the *best* accuracy (0.574) and `r` (0.531) while pinning every lopsided draft
  at 100% — a visibly broken sim. Brier is the only proper scoring rule in the
  harness; when it disagrees with those two, trust Brier. Read them as
  diagnostics, and expect an honest realism fix to cost you some of both.
- **Constants are the knobs.** Engine behaviour lives in named module constants
  (`_FIGHT_CHANCE`, `_OBJECTIVE_BASE_CHANCE`, `_STRENGTH_TO_NETWORTH`, …). Tune
  those; comment what they were calibrated against.

## Data policy

- **Ranked All Draft only** for training/calibration (`is_ranked` = game_mode 22 +
  lobby_type 7). **All rank tiers are banked** — don't narrow the harvester's
  default; the per-bracket models train on those tiers.
- **Rebuild before you measure.** `data/features/*.parquet` is a snapshot, not a
  live view — run `dm-features` first. A stale parquet once under-reported the
  corpus by 18k matches and nearly sank per-rank models as "not enough data."
- **Public data only.** OpenDota public matches; no PII. Everything in `data/` is
  git-ignored and regenerable — never commit it.
- **Never commit secrets.** No API tokens/PATs in files or command history; use
  `gh auth login` for GitHub. (A token was leaked once by pasting it — don't.)

## Dev commands

```bash
# Pipeline (Python) — the engine + ML live here
source .venv/bin/activate && pip install -e pipeline
PYTHONPATH=pipeline .venv/bin/python -m pytest pipeline/tests/     # tests
python -m dm_pipeline.prototype.sim_loop --seed 42 --export        # one sim
dm-montecarlo --radiant a,b,c,d,e --dire f,g,h,i,j --runs 200      # N-sim distribution
dm-features && dm-train-winprob                                    # rebuild data + per-bracket models
dm-calibrate --sample 2000                                         # calibration

# API (TypeScript) on :3000
cd api && npm run dev      # tsx watch
npm test                   # vitest

# Web (React) on :5173, proxies /patches,/sims,/analysis to the API
cd web && npm run dev
npm run typecheck && npm test
```

Notes:
- The API's `SimStore` caches sims at startup — after re-exporting sims, restart
  `npm run dev` to serve fresh data.
- `POST /sims` spawns the Python engine; the API needs the venv at `.venv/`
  (override with `DM_PYTHON`).
- The web viewer needs the API running alongside it.

## Testing bar

- Pipeline: `pytest` green, incl. the determinism golden-replay.
- API + web: `tsc --noEmit` clean, `vitest run` green.
- New engine behaviour ships with a test **and** a calibration check.
