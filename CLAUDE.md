# Working in this repo

Conventions for anyone (human or agent) contributing to DraftMaster. Read
[SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) for the map and
[docs/01-implementation-pipeline.md](docs/01-implementation-pipeline.md) for the
staged plan first.

## Workflow

- **One vertical per branch → PR → merge to `main`.** Branch names like
  `engine/objective-pacing`, `web/attr-groups`, `docs/refresh`.
- **Incremental commits.** Smallest coherent change per commit — usually a single
  file. Push as you go. Don't batch a dozen files into one commit.
- **No AI attribution in commits or PRs.** No `Co-Authored-By`, no "Generated
  with…" trailer. Just the change.
- **Update the progress log.** When a vertical lands, add it to
  [docs/05-progress.md](docs/05-progress.md).
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
- **Calibrate every engine change.** Run `dm-calibrate --sample 2000` and keep the
  four metrics healthy: duration within ±3 min, economy within ±5% of real
  (currently ±1%), win edge ≥ baseline, and don't tank per-hero `r`. The engine is
  tuned to **reality**, not to intuition — measure, don't guess.
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
