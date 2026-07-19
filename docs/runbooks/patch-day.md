# Runbook — Patch day

What to do when Dota ships a new patch (e.g. 7.41d → 7.42). The `patch_id` is
threaded through the whole system, so the update is mostly mechanical.

## 1. Ingest the new snapshot

```bash
source .venv/bin/activate
dm-ingest --patch-id <new_patch> --no-cache
```

Writes `data/snapshots/snapshot.<new_patch>.json` (validated against the schema).
New/reworked heroes appear automatically from OpenDota constants. The web reads
the **latest** patch on disk (`latestPatch()`), so Draft Studio and Patch Explorer
pick it up with no code change.

## 2. Point the defaults at it

- `pipeline/dm_pipeline/config.py` → `DEFAULT_PATCH_ID`.
- `pipeline/dm_pipeline/prototype/sim_loop.py` → `_DEMO_SCENARIO.patch_id`
  (and confirm the demo hero keys still exist in the new snapshot).

Run the pipeline tests: `PYTHONPATH=pipeline .venv/bin/python -m pytest pipeline/tests/`.

## 3. Let the corpus turn over

The harvester keeps banking matches; over the following days the corpus fills with
games on the new patch. There's nothing to do but wait — the cron handles it.

## 4. Refresh features, model, and calibration

Once enough new-patch matches have accrued:

```bash
dm-features
dm-train-winprob
dm-calibrate --sample 2000
```

Hero win rates (and therefore hero strength ratings) shift with the meta, so the
engine's data hook updates for free. Re-check the four calibration metrics — a big
balance patch can move game length; see [calibration.md](calibration.md).

## 5. Regenerate demo sims

```bash
rm -f data/sims/*.json
for s in 7 42 99 123; do python -m dm_pipeline.prototype.sim_loop --seed $s --export; done
# restart the API so its SimStore cache reloads
```

## Gotchas

- **Renamed hero keys** break scenarios that reference them — grep for old keys.
- The API caches sims/snapshots at startup — restart `npm run dev` after
  re-ingesting or re-exporting.
- Don't delete old snapshots; multiple patches can coexist under `data/snapshots/`.
