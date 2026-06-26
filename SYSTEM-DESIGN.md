# DraftMaster — system design

> How a real Dota 2 match becomes a **watchable simulation**.
>
> DraftMaster is a Football-Manager-style match simulator. Real match data flows
> in from OpenDota, trains a draft→win model and grounds a deterministic
> simulation engine, an offline loop calibrates that engine against reality, and
> the results are served through an API to a React web app. The **north star** is
> the Playback Viewer — watching a *generated* match unfold minute-by-minute (a
> simulation, not a replay).

This document is the developer-facing map of the whole system — every component,
**built or planned**, and how data moves between them. Read the flowchart
top-to-bottom; the dashed nodes are the roadmap.

---

## End-to-end flowchart

```mermaid
flowchart TD
    %% ===== External =====
    OD["OpenDota API<br/>free matches + constants, rate-limited"]:::data

    %% ===== Ingestion =====
    subgraph ING["Ingestion — pipeline/ Python CLI"]
        ingest["dm-ingest<br/>patch constants → snapshot"]:::py
        harvest["dm-harvest<br/>cron 3h → raw matches"]:::py
    end

    %% ===== Data store =====
    subgraph STORE["Data store — data/ git-ignored"]
        snaps[("snapshots/")]:::data
        matches[("matches/ raw")]:::data
        feats[("features/ *.parquet")]:::data
        models[("models/")]:::data
        sims[("sims/")]:::data
        calib[("calibration/")]:::data
    end

    %% ===== Features & ML =====
    subgraph ML["Features &amp; ML — scikit-learn + DuckDB"]
        features["dm-features<br/>matches → parquet, hero win rates"]:::py
        train["dm-train-winprob<br/>logistic draft→win, AUC 0.63"]:::py
    end

    %% ===== Engine =====
    subgraph ENGINE["Engine — simulation core — Python DES → Rust"]
        engine["Prototype engine ★<br/>draft + seed → deterministic event timeline<br/>economy · laning · fights+named kills · Roshan · objectives→Ancient"]:::engine
    end

    %% ===== Calibration =====
    subgraph CAL["Calibration — offline dev loop"]
        calibrate["dm-calibrate<br/>sim vs real corpus<br/>win acc 0.57 · per-hero r 0.55 · duration ✅"]:::py
    end

    %% ===== API =====
    subgraph API["API — Fastify TypeScript"]
        patchesAPI["GET /patches/:id<br/>heroes &amp; items"]:::api
        simsAPI["GET /sims/:id<br/>match timeline"]:::api
        draftAPI["POST /analysis/draft<br/>live win% (native sigmoid)"]:::api
    end

    %% ===== Web =====
    subgraph WEB["Web app — React + Vite"]
        explorer["Patch Explorer<br/>browse heroes &amp; items"]:::web
        studio["Draft Studio<br/>pick heroes → live win%"]:::web
        viewer["Match Viewer<br/>summary + net-worth graph + log"]:::web
        playback["Playback Viewer ★ north star<br/>watch the match minute-by-minute"]:::planned
    end

    %% ===== Roadmap =====
    subgraph ROAD["Roadmap — not yet built"]
        rust["Rust engine<br/>port the DES core for speed"]:::planned
        orch["Orchestrator<br/>job queue + Monte Carlo"]:::planned
        minimap["2D minimap<br/>heroes moving on the map"]:::planned
        coach["Coach Lab<br/>education / premium tier"]:::planned
    end

    %% ===== Flows =====
    OD -->|REST pulls| ingest
    OD -->|REST pulls| harvest
    ingest --> snaps
    harvest --> matches

    matches --> features
    features --> feats
    feats --> train
    train --> models

    snaps -->|loads heroes| engine
    models -.->|draft prior| engine
    engine -->|sim_result| sims
    matches --> calibrate
    engine --> calibrate
    calibrate --> calib
    calibrate -.->|tunes constants| engine

    snaps --> patchesAPI
    sims --> simsAPI
    models --> draftAPI

    patchesAPI --> explorer
    patchesAPI --> studio
    draftAPI --> studio
    simsAPI --> viewer
    viewer -.->|evolves into| playback

    engine -.->|port| rust

    %% ===== Styles =====
    classDef py fill:#E1F5EE,stroke:#0F6E56,color:#085041;
    classDef engine fill:#EEEDFE,stroke:#534AB7,color:#3C3489,stroke-width:2px;
    classDef api fill:#E6F1FB,stroke:#185FA5,color:#0C447C;
    classDef web fill:#FAECE7,stroke:#993C1D,color:#712B13;
    classDef data fill:#F1EFE8,stroke:#5F5E5A,color:#2C2C2A;
    classDef planned fill:#F6F6F4,stroke:#888780,color:#5F5E5A,stroke-dasharray:5 4;
```

**Legend** — 🟩 Python pipeline · 🟪 engine / sim core · 🟦 API (TypeScript) ·
🟧 web (React) · ⬜ data / external · ◌ dashed = planned (not yet built).

---

## How to read it: the three flows that matter

1. **Two ingestion paths, one store.** `dm-ingest` pulls *patch constants* (the
   snapshot that powers Patch Explorer and Draft Studio). `dm-harvest` runs on a
   cron banking *raw matches* (the training corpus). They serve different purposes
   but both land in `data/`.
2. **The model loops back into the engine** (the `draft prior` edge). The
   win-probability model isn't only for the Draft Studio bar — its coefficients
   seed the engine's *draft prior*, so a stronger draft starts the simulated match
   ahead.
3. **Calibration is a feedback loop, not a serving path** (the `tunes constants`
   edge). `dm-calibrate` sims real drafts offline, scores realism (per-hero win-rate
   correlation, game duration), and that result is how the engine's constants get
   tuned. It never touches the API.

The **★ Playback Viewer** is the north star. The diagram makes the punchline
visible: everything upstream already exists to feed it — the engine emits a rich
event timeline; it simply isn't *animated* yet.

---

## Component inventory

| Component | Layer | Tech | Status | Where |
|---|---|---|---|---|
| OpenDota API | External | — | external | opendota.com |
| `dm-ingest` | Ingestion | Python | ✅ built | `pipeline/dm_pipeline/ingest/` |
| `dm-harvest` | Ingestion | Python | ✅ built | `pipeline/dm_pipeline/harvest/` |
| `dm-features` | Features &amp; ML | Python · DuckDB | ✅ built | `pipeline/dm_pipeline/features/` |
| `dm-train-winprob` | Features &amp; ML | Python · scikit-learn | ✅ built | `pipeline/dm_pipeline/models/win_probability/` |
| Prototype engine | Engine | Python (DES) | ✅ built | `pipeline/dm_pipeline/prototype/` |
| `dm-calibrate` | Calibration | Python | ✅ built | `pipeline/dm_pipeline/calibrate/` |
| Patch Data API | API | TypeScript · Fastify | ✅ built | `api/src/routes/patches.ts` |
| Sims API | API | TypeScript · Fastify | ✅ built | `api/src/routes/simulations.ts` |
| Draft eval API | API | TypeScript · Fastify | ✅ built | `api/src/routes/analysis.ts` |
| Patch Explorer | Web | React · Vite | ✅ built | `web/src/pages/PatchExplorer.tsx` |
| Draft Studio | Web | React · Vite | ✅ built | `web/src/pages/DraftStudio/` |
| Match Viewer | Web | React · Vite | ✅ built | `web/src/pages/MatchViewer/` |
| Playback Viewer | Web | React · Vite | ⬜ planned | — *(north star)* |
| Rust engine | Engine | Rust | ⬜ planned | `engine/` |
| Orchestrator | Backend | — | ⬜ planned | — *(job queue + Monte Carlo)* |
| 2D minimap | Web | React | ⬜ planned | — |
| Coach Lab | Web | — | ⬜ planned | `web/src/pages/CoachLab/` *(placeholder)* |

> Some `web/src/pages/` and `api/src/routes/` entries (e.g. `Learn`, `PatchDiff`,
> `SimDashboard`, `replays.ts`, `scenarios.ts`) are scaffolded placeholders, not
> yet wired into the live flow above.

---

## Repository layout

| Path | Role |
|---|---|
| `pipeline/` | Python: ingestion, harvesting, feature store, ML models, the prototype engine, calibration |
| `engine/` | Rust simulation core — **not started** (the prototype engine will be ported here) |
| `api/` | TypeScript / Fastify read-only API serving snapshots, sims, and draft eval |
| `web/` | React + Vite frontend (Patch Explorer, Draft Studio, Match Viewer) |
| `schemas/` | JSON Schema single-source-of-truth + SQL migrations |
| `data/` | Generated artifacts (snapshots, matches, features, models, sims) — **git-ignored** |
| `infra/`, `docs/` | Deployment and documentation scaffolding |

---

## Build stages

The build follows a staged pipeline (Stage 0 design → Stage 8 launch):

| Stage | Name | Status |
|---|---|---|
| 0 | System design | ✅ done |
| 1 | Feasibility spikes | ✅ draft→win model proven (AUC 0.63) |
| 2 | Data foundation | ✅ snapshots + API + auto-harvesting corpus |
| 3 | Engine core | 🟡 prototype is a real game (towers→Ancient, Roshan, named kills); not ported to Rust |
| 4 | Orchestrator / API | 🟡 read-only API + draft eval; no job queue / Monte Carlo |
| 5 | Frontend alpha | 🟡 Patch Explorer + Match Viewer + Draft Studio; no playback / minimap |
| 6 | ML &amp; calibration | 🟡 feature store, win-prob model, realism calibration loop |
| 7 | Coach Lab / education | ⬜ not started |
| 8 | Beta &amp; launch | ⬜ not started |
