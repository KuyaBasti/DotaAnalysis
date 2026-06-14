# DraftMaster

A Dota 2 draft simulation & analysis engine — a deterministic Monte Carlo match
simulator that turns a draft (heroes, builds, skill profiles) into win-probability
distributions, timing windows, and replayable match timelines.

## Monorepo layout

| Dir | Lang | What |
|-----|------|------|
| `pipeline/` | Python | Patch ingestion, match harvesting, feature extraction, ML training |
| `engine/`   | Rust   | The deterministic simulation core, CLI, and queue worker |
| `api/`      | TypeScript | Core HTTP/WebSocket API (Fastify) |
| `web/`      | React  | Frontend — Draft Studio, Sim Dashboard, Match Viewer |
| `schemas/`  | JSON/SQL | Single source of truth for cross-language contracts + DB migrations |
| `infra/`    | —      | Docker, PaaS configs, dev scripts |
| `docs/`     | —      | System design, ADRs, runbooks |

## Quickstart

```bash
make dev      # bring up local stack (Postgres, Redis, MinIO)
make test     # run all test suites
make sim      # run a sample simulation
```

> This tree is scaffolding — most files are placeholders pending implementation.
