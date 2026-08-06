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

**Explaining the number.** Being linear in log-odds makes this model *auditable*,
which is what Coach Lab is built on. Dropping one hero's weight is an exact
counterfactual — "an average hero played this slot instead" — so
`winProbModel.explain()` reports each hero's swing in percentage points, served
at `POST /analysis/explain` and drawn under Draft Studio's win bar:

```
swing(hero) = P(win | draft) − P(win | draft with that hero's weight zeroed)
```

Two properties worth knowing before reading one: swings are expressed from the
hero's **own team's** side (a strong hero is positive whichever side drafts
them), and they **do not sum to the total** — the model is linear in log-odds,
not in probability, so leave-one-out effects genuinely don't add up. Since the
pair terms below landed, dropping a hero also drops their synergy and counter
terms, so a swing covers the hero *and their fit with this particular draft*;
pair weights are centred on zero, so "a hero with none of them" really is the
average one.

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

Per-hero swings (above) make that concrete for a player rather than a modeller —
the same draft read at two ranks:

| hero | Herald–Crusader | Ancient+ |
|---|---|---|
| Sniper | **+17.5 pp** | +7.2 pp |
| Clockwerk | **−5.2 pp** | +2.0 pp |

**Synergy and counter terms** (`pairs.py`). One column per hero makes the model
*additive*: a hero contributes the same weight regardless of who else is
drafted. That is fine for prediction and fatal for advice — "best next pick"
collapses to `argmax(weight)`, a tier list. Pair terms fix it by adding two more
blocks, both antisymmetric under swapping sides like the hero block:

```
synergy {a,b}   +1 both on radiant, -1 both on dire
counter {a,b}   +1 if a radiant & b dire, -1 if reversed   (a < b)
```

**They are trained blended, never per bracket** — measured, not assumed. ~16k
pair features against a single bracket's ~10k matches fits noise:

| trained on | AUC gain |
|---|---|
| blended, 59,410 matches | **+0.0109** (sd 0.0016, 5/5 splits positive) |
| `low` only | +0.0035 (sd 0.0025) |
| `high` only | +0.0038 (sd 0.0057, one split **negative**) |

So what ships is a hybrid — **per-bracket hero weights + blended pair weights**,
weighted by a per-bracket `alpha` (2–3) and then rescaled (below). One global
split does all of it, so the pair model never sees a bracket's evaluation rows.
The artifact (`win_probability.pairs.coef.json`) stores **hero ids, not column
indices**, so the API cannot drift from the trainer's ordering; with no such
file on disk `alpha` is 0 and scoring is byte-identical to hero-only.

The payoff isn't really the AUC — it's that a hero's value now depends on the
draft around it (`w_h + Σ synergy(h, teammates) + Σ counter(h, enemies)`), which
is the precondition for draft suggestions being advice instead of a tier list.

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
P(radiant win) = sigmoid(1.94 * edge)        # blended, n = 59,410, split-half
```

| real edge | −0.5 | −0.25 | ~0 | +0.25 | +0.5 |
|---|---|---|---|---|---|
| real radiant win rate | 37.8% | 43.9% | 55.9% | 67.7% | 78.3% |

Real drafts are far tamer than intuition suggests: the median |edge| is 0.17 and
99% fall under 0.53. `_STRENGTH_TO_NETWORTH` is tuned so the sim reproduces that
curve (mean error ~1pp across edge 0.14–1.0).

**Fit it out-of-sample.** Ratings are derived from win rates, so fitting the
slope on the same matches that produced the ratings is circular and inflates it
(2.07 in-sample vs **1.94** split-half — ratings from one half of the corpus,
slope fit on the other). Always split.

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

**Does each bracket need its own amplification?** Measured: **no.** Fit
out-of-sample, per bracket, on that bracket's own matches:

| bracket | matches | edge→win slope |
|---|---|---|
| blended (`all`) | 59,410 | 1.936 |
| Herald–Crusader (`low`) | 9,711 | 1.810 |
| Archon–Legend (`mid`) | 11,255 | 1.805 |
| Ancient+ (`high`) | 38,444 | 1.699 |

The slopes are flat across brackets (1.70–1.81), so **one global
`_STRENGTH_TO_NETWORTH` is correct** — no per-bracket gain is needed. What
changes by bracket is *which heroes* are strong, not how much a given edge is
worth. That's the useful shape: the bracket models earn their keep through hero
identity, not through a different response curve.

If anything `low` sits marginally *above* `high`, consistent with the per-bracket
AUC ordering above (draft matters most at low ranks) — and understated here,
since `low` has a quarter of `high`'s matches, so its ratings are noisier and
noisy ratings attenuate a fitted slope.

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
- **AUC cannot see calibration — anything tuned on it must be rescaled after.**
  The pair model's `alpha` was chosen on AUC, which is rank-based, so the
  combined score ranked better while drifting off the log-odds scale. The raw
  hybrid came out *more over-confident than the hero model* (mean |p−0.5| 0.097
  → 0.135 blended) with a **worse Brier at every bracket**, and it first showed
  up as Coach Lab reporting a single hero at +27 pp. A one-dimensional Platt
  rescale fitted on validation fixes it, and being monotone it leaves the AUC
  gains untouched:

  | bracket | Brier hero-only | raw hybrid | rescaled |
  |---|---|---|---|
  | all | 0.2388 | 0.2395 ✗ | **0.2366** ✓ |
  | low | 0.2280 | 0.2309 ✗ | **0.2248** ✓ |
  | mid | 0.2301 | 0.2308 ✗ | **0.2281** ✓ |
  | high | 0.2426 | 0.2433 ✗ | **0.2405** ✓ |

  This is the same shape as the engine's rating amplification: a ranking metric
  improved while the probabilities got worse. Brier is the gate.
- **Filter to the bracket, and fit out-of-sample.** A per-bracket slope table
  once reported low 1.119 vs high 2.261 — a "brackets need different
  amplification" finding that sent a whole vertical down the wrong path. Two
  bugs: the matches were never filtered to the bracket (only the *ratings* were,
  so every row silently used all 59,410 matches), and ratings and slope were fit
  on the same data. Filtered and split-half, the slopes are flat (1.70–1.81) and
  no per-bracket gain is needed. Two cheap guards: **check the row counts** — all
  four brackets reporting an identical `n` is the tell — and **check the result
  against what the repo already knows**; that table contradicted the per-bracket
  AUC ordering three paragraphs above it, which should have stopped it.
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
- ~~Hero interactions~~ — **done** (see above): blended synergy/counter terms
  layered onto the per-bracket hero weights.
- **Draft suggestions** — rank a candidate next pick against the current partial
  draft. Now meaningful rather than a tier list, since pair terms make a
  candidate's value depend on the heroes already picked.
- **Build advice** — recommend items for a draft (Coach Lab), extending the
  item builds `dm-builds` already extracts (see below).
- **Gradient boosting** — once the corpus supports richer feature sets (rank, mode,
  side, timing) beyond the linear draft model.
