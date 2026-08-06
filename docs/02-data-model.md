# Data model

Every cross-language contract lives in `schemas/` as JSON Schema (Draft-07) — the
single source of truth shared by the Python engine, the TypeScript API, and the
React web app. This doc explains each contract and the on-disk data layout.

Validate the schemas with:

```bash
.venv/bin/python -c "import json,glob; from jsonschema import Draft7Validator; \
[Draft7Validator.check_schema(json.load(open(f))) for f in glob.glob('schemas/*.json')]"
```

---

## The contracts (`schemas/`)

| Schema | Title | Status | Produced by / served at |
|---|---|---|---|
| `snapshot.schema.json` | `PatchSnapshot` | ✅ used | `dm-ingest` → `data/snapshots/`; `GET /patches/:id` |
| `scenario.schema.json` | `SimScenario` | ✅ used | the sim input; `POST /sims` body |
| `timeline-event.schema.json` | `TimelineEvent` | ✅ used | every event inside a sim |
| `sim-result.schema.json` | `SimResult` | ✅ used | sim CLI `--export` → `data/sims/`; `GET /sims/:id` |
| `sim-aggregate.schema.json` | `SimAggregate` | ✅ used | Monte-Carlo output; `dm-montecarlo` / `POST /sims/aggregate` |

### PatchSnapshot

Immutable, versioned bundle of one patch's game data — the engine loads exactly
one per run and never calls a live API. Contains `patch_id`, `source`,
`generated_at`, and arrays of **heroes** (`id`, `key`, `display_name`,
`primary_attr` ∈ `str|agi|int|all`, `attack_type`, `roles`, `base_stats`,
`stat_gain`, `attack`, `move_speed`) and **items** (`key`, `display_name`,
`cost`, `cooldown`, `mana_cost`, `components`).

- `hero.id` is the OpenDota numeric id — **the id space the ML models use**.
- `hero.key` is the stable string id (`npc_dota_hero_` stripped) — what scenarios,
  the engine, and the web use.
- `primary_attr: "all"` denotes a Universal hero (the web groups the picker
  STR / AGI / INT / Universal by this field).

### SimScenario

The sim input: `patch_id` + `radiant` + `dire` (each 1–5 hero keys that must exist
in the snapshot). Accepted by `POST /sims` and the CLI (`--radiant a,b,... --dire
c,d,...`).

### TimelineEvent

Stable envelope, type-specific payload:

```json
{ "t": 660, "type": "objective", "payload": { "team": "dire", "structure": "tier-1 tower", "lane": "top", "destroyed": 1 } }
```

`t` is game seconds (30s ticks); events are emitted in non-decreasing `t`. Payload
fields per type:

| `type` | payload fields |
|---|---|
| `game_start` | `seed`, `patch_id`, `radiant[]`, `dire[]` |
| `draft_prior` | `radiant_win_prob`, `radiant_lead` *(only with `--model`)* |
| `economy` | `radiant_gain`, `dire_gain`, `radiant_net_worth`, `dire_net_worth`, `radiant_heroes[]`, `dire_heroes[]` — each hero: `{hero, net_worth, level, kills, deaths, assists, items[]}` |
| `laning` | `radiant_bonus`, `dire_bonus` |
| `fight` | `winner`, `swing`, `radiant_win_prob`, `radiant_deaths[]`, `dire_deaths[]`, `x`, `y`; optional `comeback`, `first_blood` |
| `roshan` | `team`, `reward` |
| `level_up` | `team`, `hero`, `level` *(milestones 6/12/18/25)* |
| `item` | `team`, `hero`, `item`, `cost`, `nth` *(hero completes their nth big item; real build, calibrated timing)* |
| `objective` | `team`, `structure`, `destroyed`, `lane` *(no `lane` for the Ancient)* |
| `positions` | `radiant_heroes[]`, `dire_heroes[]` — each: `{hero, x, y}` in a 0–100 map box |
| `game_over` | `winner`, `radiant_net_worth`, `dire_net_worth` |

The **economy** event is the workhorse: the viewer's scoreboard, net-worth graph,
and win-prob strip all read the latest economy tick ≤ the playback clock.

### SimResult

One simulated match: `id` (`"<patch>-seed<seed>"`), `patch_id`, `seed`, the two
drafts, a `summary` (`winner`, `duration_seconds`, per-side `net_worth` and
`objectives`), and the full `timeline[]`. Everything the Match Viewer needs.

### SimAggregate

The Monte-Carlo output: one scenario run N times → `radiant_win_rate`,
`duration_seconds` (mean / p25 / median / p75), a `duration_histogram` (counts per
5-minute bucket), and `representative_sim_id` — a stored `SimResult` (majority-side
winner nearest the median duration) exported so it's watchable. Produced by
`dm-montecarlo` and served at `POST /sims/aggregate`.

Carries `bracket` — the rank band whose hero ratings the sims used (`all` = blended). The Draft Studio panel names it so a result is never ambiguous about which rank it describes.

---

## Engine state (in-memory, `pipeline/dm_pipeline/prototype/sim_loop.py`)

Not serialized, but the shape the timeline is derived from:

- **`HeroState`** — `key`, `display_name`, `farm_priority` (position 1–5 ladder),
  `strength` (data-derived rating, ~1.0), `net_worth`, `xp`, `level`, `kills`,
  `deaths`, `assists`, `build` (the hero's real item order, from `dm-builds`),
  `items` (completed so far).
- **`TeamState`** — `name`, `heroes[]`, `lane_power`, `objectives`, `kill_rotation`;
  properties `net_worth`, `strength_edge`.
- **`GameState`** — `radiant`, `dire`, `t`, `game_over`, `winner`,
  `roshan_available_at`, `objectives_locked_until`, `first_blood_done`,
  `last_fight_t/xy`.

---

## Feature store (`data/features/`, Parquet)

`dm-features` flattens banked matches into two DuckDB-queryable tables:

- **`matches.parquet`** — one row/match: `match_id`, `start_time`, `duration`,
  `game_mode`, `lobby_type`, `avg_rank_tier`, `radiant_win`.
- **`match_heroes.parquet`** — one row/hero/match: `match_id`, `team`
  (`radiant`/`dire`), `hero_id`.

These feed hero win rates, hero strength ratings, and the win-prob model's
training matrix. `avg_rank_tier` is what makes all three **bracket-aware** — see
[04-ml-engine.md](04-ml-engine.md) and `features/brackets.py` for the bands.

`dm-builds` writes one more artifact here — **`hero_builds.json`** (per-hero real
item builds + net-worth completion thresholds, from parsed `purchase_log`s) — the
engine loads it to narrate item timings.

---

## On-disk layout (`data/`, git-ignored)

| Dir | Contents | Written by |
|---|---|---|
| `data/snapshots/` | `snapshot.<patch>.json` (PatchSnapshot) | `dm-ingest` |
| `data/matches/` | `<match_id>.json` (raw publicMatches records) | `dm-harvest` |
| `data/details/` | `<match_id>.json` (parsed detail: `gold_t`, `purchase_log`) + unparsed ledger | `dm-backfill` |
| `data/features/` | `matches.parquet`, `match_heroes.parquet` | `dm-features` |
| `data/features/` | `hero_builds.json` (real item builds + thresholds) | `dm-builds` |
| `data/models/` | `win_probability[.<bracket>].{joblib,coef.json,metrics.json}` — one set per rank band plus the blend | `dm-train-winprob` |
| `data/models/` | `win_probability.pairs.{coef.json,metrics.json}` — blended synergy/counter weights, keyed by hero id, plus the per-bracket weighting and rescale | `dm-train-winprob` |
| `data/sims/` | `sim.<id>.json` (SimResult) | sim CLI `--export`, `POST /sims` |
| `data/calibration/` | `report.<patch>.json` | `dm-calibrate` |

Nothing in `data/` is committed; it's all regenerable from the CLIs.
