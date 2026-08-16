# Runbook — Calibration

How to check whether the engine still matches reality, and what to do when it
doesn't. Full model detail in [../04-ml-engine.md](../04-ml-engine.md).

## When to run

- After **any** engine change (a constant, a new mechanic, a resolver tweak).
- After **rebuilding features** on a grown corpus (the real targets move).
- Before merging an engine PR.

## Run it

```bash
source .venv/bin/activate
dm-features                      # rebuild the Parquet tables from data/matches/ (if the corpus grew)
dm-calibrate --sample 2000       # validate on n>=2000 — smaller samples are too noisy
dm-fit-fightscale                # re-fit the fight scale on the grown details corpus (meta refresh)
```

`dm-fit-fightscale` re-measures the fight resolver's affine scale
(`_PROB_SCALE_BASE`/`_PROB_SCALE_PER_TOTAL`) against every parsed teamfight
and prints the drift vs what the engine ships. The constants are pinned at two
totals in `tests/test_fights.py`, so acting on a drift means changing the
constants *and* the pin together — a deliberate retune, then `dm-calibrate`
again. First re-fit (corpus +20% over the original): drift under 2.3%, no
retune warranted.

Reads the report at `data/calibration/report.<patch>.json`, and prints:

```
win:      acc … vs favorite … (edge …), Brier …
realism:  per-hero win-rate r = … (target >0.8, n=… heroes); duration sim …m vs real …m (gap …m)
economy:  team net worth — min 10: sim … vs real … (x…), min 20: sim … vs real … (x…)
```

## Read the four metrics

| Line | Healthy | If it's off |
|---|---|---|
| **duration** gap | within ±3 min (currently ~0) | retune `_OBJECTIVE_BASE_CHANCE` (push pace) |
| **economy** ratio | 0.95–1.05 (currently ~1.00) | the gold constants drifted — check the economy/fight swing constants |
| **win** edge | ≥ 0 vs the favorite baseline | more fights / draft signal; don't chase this at realism's expense |
| **per-hero r** | higher is better (open target 0.8) | needs richer-than-draft signal — a research item, not a quick tune |

## Tuning discipline

- Change **one constant at a time**; re-run `--sample 2000`; keep what holds.
- **Realism first.** Historically, making the sim more faithful (real economy,
  comeback gold, fight cadence, fight XP) improved win accuracy too — optimize for
  the distribution, not the win metric.
- Use `--no-ratings` to measure the **bare engine** (no data-derived hero strength)
  when you want to isolate a mechanic from the ratings.
- For economy checks you need parsed details: run
  `python -m dm_pipeline.harvest.backfill` first so `data/details/` has gold curves.

## Sanity spot-check

Watch a few games after a change — 12 random sims is the standing audit:

```bash
for s in 1 2 3; do python -m dm_pipeline.prototype.sim_loop --seed $s --export; done
```

Then open the Match Viewer. Numbers can pass while a game still *looks* wrong;
trust the eye as well as the scoreboard.
