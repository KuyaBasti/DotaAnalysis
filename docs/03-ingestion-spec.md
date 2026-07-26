# Ingestion spec

How raw OpenDota data becomes the two things the system needs: **patch snapshots**
(game constants) and a **match corpus** (for ML + calibration). All ingestion is
Python in `pipeline/dm_pipeline/`, rate-limited, resumable, and offline-testable
against mock HTTP transports.

Source: the **OpenDota free API** (`api.opendota.com`). The client
(`harvest/opendota.py`) self-throttles to ~1 call/sec so a long run never trips
the ~60/min limit; the underlying `httpx` client is injectable so tests supply a
mock transport (no network).

---

## 1. Patch snapshots — `dm-ingest`

`dm-ingest --patch-id 7.41d` → `data/snapshots/snapshot.7.41d.json`.

- **Pulls** OpenDota constants (`heroes`, `items`).
- **Normalizes**:
  - `key` = hero/item name with the `npc_dota_hero_` prefix stripped
    (`npc_dota_hero_juggernaut` → `juggernaut`), lowercased, `^[a-z0-9_]+$`.
  - `roles` lowercased; missing → `[]`.
  - `primary_attr` mapped to `str|agi|int|all` (`all` = Universal).
  - Item `cost`/`cooldown`/`mana_cost` → number or `null`.
- **Validates** the result against `schemas/snapshot.schema.json` before writing;
  an invalid snapshot is never persisted.
- **Deterministic**: same patch id + same upstream constants → byte-identical
  file (stable key ordering). `--no-cache` forces a fresh fetch.

`patch_id` is a label the operator passes; it's threaded through every downstream
component. Never hardcode "current patch" anywhere else — read it from the
snapshot / scenario.

---

## 2. Match corpus — `dm-harvest`

`dm-harvest --max N` pages recent public matches newest-first and banks each as
`data/matches/<match_id>.json`.

### Scope filter (ranked All Draft only)

`features.build_dataset.is_ranked()` is the single definition, reused by the
harvester and the feature extractor:

```
is_ranked  ⟺  game_mode == 22 (All Draft)  AND  lobby_type == 7 (ranked)
```

Non-ranked records (Turbo, unranked) are skipped **before** they're stored, so the
corpus is clean at rest. This is a product decision: DraftMaster studies real
ranked play. (~90% of the public stream is out of scope, so the collector pages
deeper to fill a quota.)

### Rank bracket

`--min-rank <tier>` (OpenDota tier: 70 = Divine, 80 = Immortal) filters
**server-side** — zero wasted API budget. Default is **all ranks** (`0`); every
bracket is retained on purpose, and that policy paid off: the per-bracket models
(see [04-ml-engine.md](04-ml-engine.md)) train on those rank tiers, so a player
can analyze a draft at the rank they actually play.

### Dedup & resumability (the load-bearing property)

- Files are keyed by `match_id`. A file already on disk is **never re-fetched**.
- Re-running `dm-harvest` banks **zero** already-stored matches — it just pages
  until it finds `--max` new ones. This makes the cron safe to run repeatedly.
- Paging uses `less_than_match_id` = the smallest id seen, walking backwards
  through history without gaps.

The cron (`0 */3 * * *`, every 3h) drives this unattended; the corpus is 100k+ and
grows on its own while the machine is awake.

---

## 3. Parsed details — `dm-backfill`

`python -m dm_pipeline.harvest.backfill` enriches a sample of banked matches with
**full parsed detail** via `/matches/{id}` → `data/details/<match_id>.json`. These
carry the ground truth the economy is calibrated against:

- `players[].gold_t` — each player's net worth **per minute** (the real gold
  curves; see [04-ml-engine.md](04-ml-engine.md) and the economy calibration).
- `players[].purchase_log` — real item builds with timings, consumed by
  `dm-builds` to drive the viewer's **item-timing beats** (which items a hero
  buys, and the net worth real players finish them at).

Robustness (an API this size hiccups constantly):

- **429** (rate limit): honor `Retry-After` / back off; stop cleanly when the
  budget is exhausted — the run resumes later.
- **5xx / transport errors** on a single match: skip it and keep going.
- **Not-yet-parsed matches**: recorded in an unparsed-id ledger so they aren't
  retried forever; already-fetched matches are skipped (resumable).

Only ~half of banked matches are parsed on OpenDota at a given time, so backfill
is best-effort and incremental.

---

## Description of a clean corpus (what "good" looks like)

- Every file in `data/matches/` is a finished ranked All Draft 5v5.
- Re-running any ingest step is a no-op on already-captured data.
- `dm-features` can rebuild the Parquet tables from `data/matches/` at any time;
  nothing downstream depends on ingest order.
