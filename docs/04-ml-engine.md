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
simulated Anti-Mage differ from a simulated Invoker. The sim CLI/API load these
by default (`load_default_ratings()`, graceful when no features exist yet).

**How hard should a rating edge swing the result?** Not a matter of taste — it's
measured. Define a draft's *edge* as summed hero strength above neutral, radiant
minus dire. Over 59,410 real ranked matches that edge maps to the real win rate
as a clean logistic:

```
P(radiant win) = sigmoid(2.07 * edge)        # blended ratings, n = 59,410
```

| real edge | −0.5 | −0.25 | ~0 | +0.25 | +0.5 |
|---|---|---|---|---|---|
| real radiant win rate | 37.8% | 43.9% | 55.9% | 67.7% | 78.3% |

Real drafts are far tamer than intuition suggests: the median |edge| is 0.17 and
99% fall under 0.53. `_STRENGTH_TO_NETWORTH` is tuned so the sim reproduces that
curve (mean error ~1pp across edge 0.14–1.74).

> **The double-count that made the sim over-confident.** Strength used to be paid
> out twice — once through the economy (stronger heroes farm more, growing a
> net-worth lead the fight logistic already reads) and again as a separate
> 16,000-gold fight edge on top. A draft real players win 63% of the time
> simulated at 87%; a p95 draft, 74% real, simulated at 98%; lopsided drafts
> pinned at a flat 100%. The fix was to recognise the economy already carries
> most of the signal and drop the fight term to 2,000. No cap or squash was
> needed — saturation was a symptom of the double-count, not of the curve shape.

Ratings are also **bracket-aware** (`hero_strength_ratings(bracket=...)`): Sniper
rates 1.185 in Herald–Crusader but 0.999 at Ancient+; Clockwerk 0.825 → 1.053.
The sim takes `--bracket`; the *default* stays blended.

Two measurements, and they say different things — both worth keeping:

- **Win accuracy: no gain.** Bracket-matched ratings did not improve the sim's
  ability to pick the real winner (edge −0.029 vs −0.020 blended, n=800).
- **Distribution: large effect.** Over 400 sims per bracket, the same draft with
  one hero swapped per side (Sniper vs Clockwerk) wins **64.5% at low and 40.0%
  at high** — a 24.5-point swing on a single swap.

These aren't in conflict. Win accuracy is capped by draft-only information and
was never the engine's job; the *distribution* is what Monte-Carlo analysis
consumes, and there the bracket matters a great deal. Hence: blended by default
for a single sim, bracket-selectable for analysis.

> **Known limitation — one global constant, three real slopes.** Each bracket
> has its *own* measured edge→win curve, and they differ a lot:
>
> | bracket | real slope | sim slope | |
> |---|---|---|---|
> | blended (`all`) | 2.071 | ~2.07 | matched |
> | Ancient+ (`high`) | 2.261 | ~2.07 | close |
> | Archon–Legend (`mid`) | 1.237 | ~2.07 | 1.7× too steep |
> | Herald–Crusader (`low`) | 1.119 | ~2.07 | 1.9× too steep |
>
> `_STRENGTH_TO_NETWORTH` is a single global constant tuned to the blended
> slope, so the default and `high` are well calibrated while `low`/`mid`
> analysis is still over-confident — a top-5-vs-bottom-5 draft reads ~99% at
> `low` where that bracket's own curve implies ~91%. Note the shape of the
> finding: draft edge decides *less* at low ranks, not more (individual play
> varies more), which is the opposite of the naive guess. The fix is to scale
> each bracket's rating deviations by `k_bracket / k_blended`; open follow-up.

The win-prob model also feeds the engine a **draft prior** (`--model`): its
predicted P(radiant) seeds a starting net-worth edge.

---

## 3. Calibration harness — `dm-calibrate`

The offline loop that keeps the engine truthful. It sims a sample of **real
drafts** from the corpus and scores four things in one run
(`--sample N`, validate on n ≥ 2000):

| Metric | What it asks | Gate? | Where |
|---|---|---|---|
| **Brier** | are the sim's *probabilities* honest? | ✅ **the win gate** | `calibrate/compare.py` |
| **Duration** | do games last as long as real ones? | ✅ within ±3 min | `calibrate/compare.py` |
| **Economy** | is team net worth right at min 10/20 vs **parsed real curves**? | ✅ within ±5% | `calibrate/economy.py` |
| Win accuracy | does the sim pick the real winner? (capped by draft-only info) | ⚠️ diagnostic only | `calibrate/compare.py` |
| Per-hero win-rate `r` | does the sim reproduce *which heroes win*? (Pearson vs real) | ⚠️ diagnostic only | `calibrate/compare.py` |

The last one is a permanent guardrail added after the economy was calibrated to
`data/details`: it reports sim-vs-real team net worth so a future engine change
can't silently drift the gold.

Example output:

```
win:      acc 0.514 vs favorite 0.567 (edge -0.052), Brier 0.296
realism:  per-hero win-rate r = 0.454 (target >0.8, n=125 heroes); duration sim 35.1m vs real 34.2m (gap +0.8m)
economy:  team net worth — min 10: sim 15,569 vs real 15,370 (x1.013), min 20: sim 38,643 vs real 38,803 (x0.996)
```

**Current state:** Brier 0.296 (best measured), duration +0.8m, economy ±1.3% —
all three gates met.

### Rigor lessons (baked into the harness)

- **Validate on n ≥ 2000.** Small samples (n=200) gave estimates that collapsed at
  n=400 — noise, not signal.
- **Per-draft seeds**, not one shared seed set — a single seed's quirks biased the
  sim toward one side (looked ~17% Radiant vs reality's ~55% until fixed).
- **Ranked-only, all brackets.** Turbo pollution wrecked hero-rate correlation and
  duration; filtering to ranked fixed it. All rank tiers are kept for per-bracket
  models later.
- **Win accuracy and per-hero `r` reward over-confidence — don't gate on them.**
  Hero ratings are derived from real win rates, so a sim that merely ranks by
  rating scores well on both. Sweeping `_STRENGTH_TO_NETWORTH` shows it plainly:

  | constant | accuracy | per-hero `r` | Brier |
  |---|---|---|---|
  | **2,000** (calibrated) | 0.514 | 0.454 | **0.296** |
  | 16,000 (old) | 0.548 | 0.506 | 0.308 |
  | 32,000 | 0.570 | 0.531 | 0.341 |
  | 64,000 | **0.574** | **0.531** | 0.373 |

  At 64,000 every lopsided draft pins at 100% — a visibly broken sim, and
  precisely where accuracy and `r` peak. Brier, the only proper scoring rule
  here, moves the right way. An honest realism fix should be *expected* to cost
  accuracy: reproducing a 74%-real matchup means losing 26% of those games,
  while always backing the favorite does not.

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
