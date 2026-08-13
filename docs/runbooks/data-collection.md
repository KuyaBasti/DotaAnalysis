# Runbook — Data collection

Two cron jobs grow the corpus unattended. Full ingestion detail in
[../03-ingestion-spec.md](../03-ingestion-spec.md).

## What runs

```
0  */3        * * *   dm-harvest  --max 1500  >> data/harvest.log  2>&1
30 1,7,13,19  * * *   dm-backfill --max 500   >> data/backfill.log 2>&1
```

Both are resumable and idempotent, so a missed run costs nothing — the next one
picks up where it left off. Backfill sits at `:30` so it never overlaps the
harvester at `:00`; they share one OpenDota rate limit.

| | harvester | backfill |
|---|---|---|
| fetches | ~15 calls (pages of 100) | 1 call per match |
| yield | 1500 ranked matches / run | ~270 parsed / run (≈55% of 500 are parsed upstream) |
| scope | **all rank tiers** | **Divine+ only** (see below) |

## Why backfill stays Divine-only

`--min-rank` defaults to 70 and the cron leaves it there. This is load-bearing:
`calibrate/economy.py` globs **every** file in `data/details/` with no rank
filter, so the economy calibration gate is measured against whatever sits in
that directory. The engine's gold constants were tuned against Divine curves —
letting lower brackets in would move one of the three calibration gates without
anyone touching the engine.

If you ever do want all-rank details, filter inside `economy.py` *first*, then
re-baseline the economy numbers deliberately.

## Checking on it

```bash
tail -5 data/harvest.log data/backfill.log
ls data/matches/ | wc -l          # raw ranked matches
ls data/details/*.json | wc -l    # parsed detail (gold curves + purchase logs)
```

A healthy backfill line reads like `fetched 500, stored 270 parsed, N
known-unparsed`. (Batch raised 200 → 500 after measuring the cron's real
cadence: macOS `cron` skips slots that pass while the laptop sleeps — only
~43% of scheduled runs landed in the first days — so each run that does land
carries a bigger batch. The client's 1 req/sec throttle makes a 500-fetch run
~8 minutes, still far inside the :30 offset from the harvester.) The known-unparsed count only grows: OpenDota hasn't parsed
those matches, and the ledger (`data/details/_unparsed.json`) stops them being
refetched forever.

**If `stored` is 0 across several runs** the corpus has outrun what OpenDota has
parsed — not an error, just nothing new to take. **If `fetched` is 0**, every
banked match has already been tried.

## Why the parsed corpus matters

It is the binding constraint on the remaining roadmap, not code. Both Coach
Lab's **timing windows** and the **fight-outcome model** need per-minute gold
curves and teamfight detail, and neither is buildable on a few hundred games.
The raw match corpus (127k+) has never been the bottleneck; parsed detail has.
