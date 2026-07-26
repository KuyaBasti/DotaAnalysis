# ML engine

DraftMaster's ML has two jobs: **predict** (a fast draft→win model for the Draft
Studio) and **ground the simulation** (data-derived hero strength + a calibration
loop that keeps the engine honest against reality). All Python, in
`pipeline/dm_pipeline/`.

A guiding principle, learned the hard way: **win-prediction accuracy is the wrong
goal for the engine.** With only draft information the engine can never out-predict
the direct model, and that's fine — the engine's job is *believable dynamics*
(realistic gold curves, game lengths, hero win-rate spreads), which the Draft
Studio's win% doesn't need. So the engine is optimized for **distributional
realism**, not for guessing winners.

---

## 1. Win-probability model — `dm-train-winprob`

A logistic regression over the draft.

- **Features**: one column per hero id; `+1` if on Radiant, `-1` if on Dire, `0`
  if absent. **Label**: `radiant_win`.
- **Training**: `train_test_split`, `LogisticRegression`, from
  `data/features/matches.parquet` + `match_heroes.parquet`.
- **Output** (`data/models/`): `win_probability.joblib`, `metrics.json`, and
  crucially `win_probability.coef.json` — the intercept + per-hero weights.
- **Serving**: the API scores natively — `sigmoid(intercept + Σ weights·draft)` in
  TypeScript (`api/src/winProbModel.ts`), parity-tested against sklearn. **No
  sklearn/ONNX runtime in the API.** This powers `POST /analysis/draft` and the
  Draft Studio's live win% bar.

**Per-bracket models.** `dm-train-winprob` trains one model per rank band plus
the blended one (`--bracket every`, the default), writing
`win_probability[.<bracket>].coef.json`. The API serves whichever the caller asks
for (`POST /analysis/draft {bracket}`), falling back to blended.

| model | held-out AUC |
|---|---|
| Herald–Crusader (`low`) | **0.663** |
| Archon–Legend (`mid`) | 0.650 |
| Ancient+ (`high`) | 0.584 |
| blended (`all`) | 0.614 |

**Every bracket beats the blend**, and the ordering is the finding: *draft
matters most at low ranks and least at high ranks*. That resolves the
long-standing "draft explains less at higher skill" ceiling — it was never a
modelling failure, it was two different games averaged together. Example: a
Sniper/Pudge/Broodmother draft scores 98% in Herald–Crusader and 58% at Ancient+
(blended says 83%, describing neither).

---

## 2. Hero strength ratings — the engine's data hook

`features.hero_strength_ratings()` turns each hero's **real win rate** into a
multiplier (~1.0):

```
shrunk_wr = (wins + prior·0.5) / (games + prior)        # shrink low-sample heroes toward 0.5
rating    = 1.0 + scale · (shrunk_wr − 0.5)             # e.g. 0.90 (weak) … 1.19 (strong)
```

This is **the seam where real data enters the engine**: a stronger hero farms a
bit more (economy) and is favored a bit more in fights. It's what makes a
simulated Anti-Mage differ from a simulated Invoker — proven directly: a
meta-top-5 vs meta-bottom-5 draft goes from a 40% (ratings off) to 100% (ratings
on) win rate over fixed seeds. The sim CLI/API load these by default
(`load_default_ratings()`, graceful when no features exist yet).

Ratings are also **bracket-aware** (`hero_strength_ratings(bracket=...)`): Sniper
rates 1.185 in Herald–Crusader but 0.999 at Ancient+; Clockwerk 0.825 → 1.053.
The sim can opt in with `--bracket`, but **the default stays blended** — measured
honestly, bracket-matched ratings did *not* improve the sim's win accuracy
(edge −0.029 vs −0.020 blended, n=800). Per-rank sharpens *hero identity*, which
helps prediction and analysis; it adds no side-specific signal the engine lacks.

The win-prob model also feeds the engine a **draft prior** (`--model`): its
predicted P(radiant) seeds a starting net-worth edge.

---

## 3. Calibration harness — `dm-calibrate`

The offline loop that keeps the engine truthful. It sims a sample of **real
drafts** from the corpus and scores four things in one run
(`--sample N`, validate on n ≥ 2000):

| Metric | What it asks | Where |
|---|---|---|
| **Win accuracy / Brier** | does the sim pick the real winner? (capped by draft-only info) | `calibrate/compare.py` |
| **Per-hero win-rate `r`** | does the sim reproduce *which heroes win*? (Pearson vs real) | `calibrate/compare.py` |
| **Duration** | do games last as long as real ones? | `calibrate/compare.py` |
| **Economy** | is team net worth right at min 10/20 vs **parsed real curves**? | `calibrate/economy.py` |

The last one is a permanent guardrail added after the economy was calibrated to
`data/details`: it reports sim-vs-real team net worth so a future engine change
can't silently drift the gold.

Example output:

```
win:      acc 0.554 vs favorite 0.544 (edge +0.010), Brier 0.307
realism:  per-hero win-rate r = 0.560 (target >0.8, n=124 heroes); duration sim 35.2m vs real 35.5m (gap -0.3m)
economy:  team net worth — min 10: sim 15,432 vs real 15,370 (x1.004), min 20: sim 38,467 vs real 38,803 (x0.991)
```

**Current state:** duration exact-to-median, economy ±1% (both realism gates met);
per-hero `r` ≈ 0.56 is the tracked open target (0.8 goal). A recurring result
worth stating: **modeling reality more faithfully has improved win accuracy every
time** — real economy, comeback gold, more fights, fight XP each nudged the edge
up, not down.

### Rigor lessons (baked into the harness)

- **Validate on n ≥ 2000.** Small samples (n=200) gave estimates that collapsed at
  n=400 — noise, not signal.
- **Per-draft seeds**, not one shared seed set — a single seed's quirks biased the
  sim toward one side (looked ~17% Radiant vs reality's ~55% until fixed).
- **Ranked-only, all brackets.** Turbo pollution wrecked hero-rate correlation and
  duration; filtering to ranked fixed it. All rank tiers are kept for per-bracket
  models later.

---

## Roadmap — richer models

These need richer-than-draft signal; the data is **already banked** in
`data/details/` (parsed gold curves + purchase logs — the latter now also feed
`dm-builds`, which extracts real per-hero item builds and net-worth completion
thresholds that drive the viewer's item-timing beats):

- **Fight-outcome model** — replace the analytic fight resolver with one learned
  from parsed teamfight data (same interface: game-state in, win-prob + swing out).
- ~~Per-rank models~~ — **done** (see above): per-bracket win-prob models and
  hero ratings, selectable in Draft Studio.
- **Build advice** — recommend items for a draft (Coach Lab), extending the
  item builds `dm-builds` already extracts (see below).
- **Gradient boosting** — once the corpus supports richer feature sets (rank, mode,
  side, timing) beyond the linear draft model.
