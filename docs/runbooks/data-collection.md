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

A healthy harvest line is `stored 1500 new matches to …`; on a dead network
the run now writes one line (`network error (…); stopping this run — the next
one resumes`) instead of the tracebacks older log entries show. A healthy
backfill line reads like `fetched 500, stored 270 parsed, N
known-unparsed`. (Batch raised 200 → 500 after measuring the cron's real
cadence: macOS `cron` skips slots that pass while the laptop sleeps — only
~43% of scheduled runs landed in the first days — so each run that does land
carries a bigger batch. The client's 1 req/sec throttle makes a 500-fetch run
~8 minutes, still far inside the :30 offset from the harvester.)

The backfill walks **newest matches first** — everything downstream of
`data/details/` measures the current meta, and the old oldest-first order once
left a 32k pre-patch backlog queued ahead of a new patch's first game (weeks
of budget before the new meta gained a single parsed match). The unparsed
ledger (`data/details/_unparsed.json`) is **age-aware**: OpenDota parses
lazily, often days late, so a match tried while young is retried after a
2-day cooldown until it parses or ages past a 14-day grace; a match tried
when already old is final. The known-unparsed count can therefore dip as
young misses later parse and clear their entries.

**If `stored` is 0 across several runs** the corpus has outrun what OpenDota has
parsed — not an error, just nothing new to take. **If `fetched` is 0**, every
banked match is stored, final, or on retry cooldown.

## Why the parsed corpus matters

It has been the binding constraint on the roadmap, not code. Coach Lab's
**timing windows** (needs per-minute gold curves) and the **fight resolver's
calibration** (11,212 teamfights extracted at ~1,500 parsed matches) both
shipped the moment the corpus could carry them; neither was buildable on a few
hundred games. The raw match corpus (127k+) has never been the bottleneck;
parsed detail has. It keeps paying as it grows: the timing windows' hero
coverage gate fills itself, and the per-patch meta refresh re-measures
everything on fresh games.
