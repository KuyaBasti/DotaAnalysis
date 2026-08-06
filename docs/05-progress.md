# Progress log

Living record of what's shipped. Newest first. Keep it updated as verticals land
(one entry per merged PR or coherent chunk). Metrics are the last measured values;
re-run `dm-calibrate --sample 2000` after engine changes.

## Where things stand

- **65 PRs merged.** The core loop works end-to-end: **draft → predict → simulate
  → watch → analyze → understand**, all of it **at the rank bracket you play**,
  and every realism issue from the audits is closed.
- **Engine:** a full, watchable ranked game — real (Divine-calibrated) economy,
  laning, teamfights with named casualties + K/D/A, Roshan, XP/levels, two-sided
  laned objectives → Ancient, and moving hero positions.
- **Calibration (n=2000):** Brier 0.296 (the win gate, best measured), duration
  +0.8m of real, economy within ±1.3% of parsed real gold at min 10/20. The sim's
  draft-edge→win curve now tracks the one measured on 59,410 real matches to
  ~1pp.
- **Data:** 127k matches banked / **59.4k ranked** in the feature store (every
  bracket viable to train on), plus a growing sample of
  parsed details (gold curves + purchase logs) in `data/details/`.
- **Not shipped.** Personal project; no deploy.

## Stage status

| Stage | Status |
|---|---|
| 0 System design | ✅ done |
| 1 Feasibility | ✅ done |
| 2 Data foundation | ✅ done |
| 3 Engine core | ✅ Python engine complete · ⬜ Rust port |
| 4 Orchestrator/API | 🟡 API + simulate + **bracket-aware Monte Carlo** · ⬜ batch job queue |
| 5 Frontend | ✅ done (Draft Studio + Match Viewer playback) |
| 6 ML & calibration | 🟡 four-metric harness + **per-bracket models** + **hero interactions** · ⬜ fight-outcome model |
| 7 Coach Lab | 🟡 **draft explanation** (per-hero swings) · ⬜ timing windows · ⬜ draft suggestions |
| 8 Beta & launch | ⬜ not started |

## The arc so far (grouped)

**Foundation (Stages 0–2).** Monorepo scaffolding; snapshot schema + `dm-ingest`;
read-only Patch Data API; Patch Explorer web page. Match harvester (`dm-harvest`),
resumable, on a 3-hour cron. Feature store (`dm-features`, Parquet + DuckDB).

**First ML + the second tracer bullet.** Draft→win logistic model
(`dm-train-winprob`); coefficients served natively by the API (`POST
/analysis/draft`); Draft Studio's live win% bar. Sim results exported and served
(`GET /sims`); first Match Viewer (static summary + net-worth graph + log).

**Engine into a real game.** Deterministic DES (economy, laning, analytic fights);
objectives model (towers → Ancient as the win condition); narrative beats (named
fight casualties, Roshan). Calibration harness with win + realism (per-hero `r`,
duration) scoreboards.

**The watch-the-game vertical (north star).** Playback Viewer: game clock
(play/pause/scrub/speed), live scoreboard, net-worth graph revealed to the
playhead, win-probability strip, narrated match feed. Sim picker. Comeback gold.
Hero scoreboard with levels then K/D/A. **2D minimap** with structures falling and
**ten hero dots moving** (laning → push fronts → fight clusters).

**Grounding in reality.** Ranked-only data policy; re-ingest to the current patch
(7.41d). **Real economy** — backfilled parsed Divine games (`dm-backfill`) and
recalibrated every gold constant to real per-minute curves (economy metric added
to `dm-calibrate`). Objective pacing (regroup cooldown + high-ground toughness) so
stomps can't end at 16:00; duration distribution matched to real.

**Draft → watch, and audit-driven polish.** `POST /sims` + Draft Studio's
"Simulate this draft" button → watch your own match; humanized sim labels. Hero
picker grouped **STR / AGI / INT / Universal**. Then a 12-random-sim audit drove
five fixes: watched sims now load hero ratings; real kill volume + core-weighted
K/D/A; losing teams take towers (two-sided pressure); fight XP for real late-game
levels.

**Documentation refresh.** README, SYSTEM-DESIGN, the `docs/` suite, the root agent file,
filled schemas — brought up to reality.

**Item timings.** `dm-builds` extracts real per-hero item builds and
net-worth completion thresholds from parsed purchase logs; the engine narrates
them (`item` events) as heroes finish their real builds at calibrated net worth,
shown in the match feed and on the scoreboard. Rng-free (items are narrative).

**Audit close-out.** The last refinements from the 12-random-sim audits:
**always a throne** — a late-game push ramp (plus a cap safety net) so every
game ends with the Ancient falling, never an abstract time-cap decision;
**first-blood timing** — the data overturned the hunch (real Divine first bloods
are *very* early: median ~0.9 min, 60% inside the first minute), so the sim was
front-loaded to match. No known realism defects remain.

**Monte-Carlo analysis (Stage 4).** `prototype/montecarlo.py` (`dm-montecarlo`)
runs a draft N times → win-probability distribution + duration spread + a
representative game (majority-side winner nearest the median), exported so it's
watchable. Served at `POST /sims/aggregate`; Draft Studio's **📊 Analyze (200
sims)** button shows the win bar, a duration histogram, and a "watch a
representative game" jump into the viewer. 200 sims ≈ 1.3s — fast enough on
demand, so the Rust port stays a future optimization.

**Per-rank models (Stage 6).** `features/brackets.py` defines three bands
(Herald–Crusader / Archon–Legend / Ancient+ — eight medals are too thin to train
on, three each clear ~9k matches). Hero win rates, strength ratings, and the
win-prob model are all bracket-aware; `dm-train-winprob` trains one model per
band plus the blend. **Every bracket model beats the blend, and the ordering is
the finding:** AUC 0.663 low / 0.650 mid / 0.584 high vs 0.614 blended — *draft
matters most at low ranks and least at high ranks*, which finally explains the
long-standing "draft explains less at higher skill" ceiling (it was two
different games averaged together). Real hero swings back it up: Sniper +9.5
points low-vs-high, Clockwerk −12.8. The API serves any bracket
(`POST /analysis/draft {bracket}`, falling back to blended) and Draft Studio has
a rank selector. Honest negative result recorded: bracket-matched *ratings* did
not improve the sim's win accuracy, so the sim's default stays blended
(`--bracket` is opt-in).

**Agent-facing docs restructure.** The always-loaded root file is now
`AGENTS.md` (portable to non-Claude agents; `CLAUDE.md` is a one-line
`@AGENTS.md` alias), and it leads with a **routing table** — Area → Location —
so an agent learns where code lives without searching. Added
[`docs/README.md`](README.md), a hub with an explicit read order plus topical
companions, which finally surfaces `decisions/` and `runbooks/`. Principle:
root = concise routing, `docs/` = explanation, code = final source of truth.

**Bracket-aware Monte Carlo.** Wired the two halves together — Monte Carlo and
the per-bracket models shipped days apart without talking. It began as a bug:
Draft Studio already sent `bracket` with every Analyze request and the API
dropped it (`AggregateRequest` had no such field, the runner never passed
`--bracket`), so the rank selector moved the win% but every 200-sim run used
blended ratings. Now the bracket reaches the engine, the panel names the rank it
analyzed, and `bracket` is part of the `SimAggregate` contract. The payoff: one
hero swapped per side swings **99.5% (Herald–Crusader) → 60.0% (Ancient+)**,
where blended says 81% — wrong at both ends. This also qualified an earlier
negative result: bracket ratings don't help *win accuracy*, but they move the
*distribution* a lot, which is what analysis actually reads. (Those percentages
were measured before the amplification fix below — the bracket *separation* held
up, the magnitudes did not.)

**Rating amplification, and a lesson about the metrics.** The roadmap called
this "soften the tails"; measuring it showed the diagnosis was wrong. Hero
strength was paid out **twice** — stronger heroes already farm more, growing a
net-worth lead the fight logistic reads directly, and the fight resolver then
added 16,000 gold per rating point on top. So the over-confidence was never
confined to absurd drafts: a draft real players win 63% of the time simulated at
87%, and that edge sits at only the ~60th percentile of real drafts. The target
came from data — over 59,410 ranked matches a draft's rating edge maps to
`P(win) = sigmoid(1.94 * edge)` — and dropping the fight term 16,000 → **2,000**
reproduces that curve within ~1pp (it was off by 16pp). No cap or squash was
needed; saturation was a symptom, not the disease. Ordinary drafts benefited
most: a one-hero-per-side swap went from 99.5%/60.0% (low/high) to a usable
**64.5%/40.0%**, bracket separation intact. The twist: **win accuracy and
per-hero `r` both got worse** — and that turned out to be correct. Both metrics
are maximized by over-confidence, since ratings derive from real win rates;
pushing the constant to 64,000 gives the *best* accuracy and `r` while pinning
every lopsided draft at 100%. Brier (the only proper scoring rule in the
harness) improved, 0.308 → 0.296. The engine-discipline rule in
[AGENTS.md](../AGENTS.md) was corrected accordingly: **Brier is the gate; those
two are diagnostics.**

**The follow-up that measured itself out of existence.** That vertical closed by
naming a successor: each bracket supposedly had its own edge→win slope (low
1.119 … high 2.261), so `low`/`mid` analysis was ~1.9× too steep and wanted a
per-bracket gain. Re-measuring before building it killed it. The table had two
flaws — the matches were never filtered to the bracket (only the *ratings* were,
so all four rows silently used the whole 59,410-match corpus, which is why they
all reported an identical `n`), and ratings and slope were fit on the same data,
which is circular. Filtered and split-half, the slopes are **flat: 1.810 low /
1.805 mid / 1.699 high / 1.936 blended.** So one global constant is right, no
per-bracket gain is needed, and `_STRENGTH_TO_NETWORTH = 2,000` is still the
best fit against the honest blended slope (1.0pp). No code changed. The
worthwhile part is the shape: brackets differ in *which heroes* are strong, not
in how much a given edge is worth — the per-bracket models earn their keep
through hero identity. The bogus table also contradicted the per-bracket AUC
ordering sitting three paragraphs above it in the same doc, which should have
caught it; both guards are now written into the rigor lessons in
[04-ml-engine.md](04-ml-engine.md).

**Coach Lab opens: why a draft wins (Stage 7).** Draft Studio has always shown
*a number*; now it shows **who is moving it**. `POST /analysis/explain` returns a
per-hero swing — the percentage points that hero adds to their own side versus
an average pick in the same slot — and an `ExplanationPanel` draws them as
diverging bars under the win bar, riding the same effect as the live win% so the
two can never disagree. The decomposition is **exact, not a heuristic**: the
win-prob model is a logistic regression, linear in log-odds, so dropping a
hero's weight is a genuine counterfactual. Two honesty choices baked in — swings
read from the hero's own team's side (a strong hero is positive on either team),
and they deliberately *don't* sum to the total, because the model is linear in
log-odds, not in probability; the panel says so instead of implying a tidy
decomposition. **This is where the per-bracket work finally becomes visible to a
player:** same draft, rank selector moved, Sniper goes **+10.2pp
(Herald–Crusader) → −0.1pp (Ancient+)** while Clockwerk goes **−5.5 → +4.0** —
the long-standing bracket finding surfaced per hero instead of buried in an AUC
table. *(Those swings were measured before the pair terms below; the shape of
the finding held, the magnitudes grew.)*

**Hero interactions — synergy and counters.** The Coach Lab entry above closed
with a limitation: the model scored heroes individually, so a hero contributed
the same weight no matter who else was drafted. That is fine for prediction and
fatal for advice — "best next pick" collapses to `argmax(weight)`, a tier list
with a filter. So the next slice was gated on a question, and the spike ran
*before* any building: can 59,410 matches support ~16k pair features? Answer:
blended yes (**+0.0109 AUC**, sd 0.0016, 5/5 splits positive), per bracket no
(`high` +0.0038, sd 0.0057, one split *negative*). What ships is therefore a
hybrid — per-bracket hero weights plus **blended** pair weights, weighted by a
per-bracket alpha.

**And then it nearly shipped broken, the same way the rating amplification did.**
alpha is tuned on AUC, which is rank-based and blind to probability scale, so
the combined score ranked better while drifting off the log-odds scale: the raw
hybrid was *more over-confident* than the hero model (mean |p−0.5| 0.097 →
0.135) with a **worse Brier at every bracket**, and it surfaced as Coach Lab
reporting a single hero at +27pp. A per-bracket Platt rescale fitted on
validation fixed it — Brier now beats hero-only everywhere (0.2388 → 0.2366
blended) and, being monotone, the AUC gains survive. Twice now a ranking metric
has improved while the probabilities got worse; **Brier is the gate** is in
[AGENTS.md](../AGENTS.md) for exactly this.

The payoff isn't the AUC, it's that a hero's value now depends on the draft
around it — which is what makes draft suggestions advice rather than a tier
list. The test that pins it: a hero with weight 0.0 swings *nothing* alone and a
real amount beside their synergy partner.

## Next — the additive roadmap

The engine's realism work is done; what's left adds new capability (nothing is a
fix). See [../SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md) for the map.

1. **Coach Lab** (Stage 7) — *why a draft wins* is in. The two remaining slices:
   **draft suggestions** (rank the next pick against the current partial draft at
   the player's bracket — now unblocked, since pair terms make a candidate's
   value depend on what is already drafted) and **timing windows** (when a draft
   is strongest/weakest, from the Monte-Carlo runs plus `dm-builds` item spikes).
   Both build on the explanation seam rather than replacing it.
2. **Fight-outcome model** (Stage 6) — learn the fight resolver from parsed
   teamfight data instead of the analytic logistic.
3. ~~Per-bracket amplification~~ — **investigated, not needed.** The table that
   motivated it was a measurement bug (see the arc entry above); measured
   properly the per-bracket slopes are flat, so one global constant is correct.
4. **Rust engine port** (Stage 3) — speed for large batch Monte-Carlo runs.
5. **Batch job queue** (Stage 4) — enqueue long runs rather than run inline.
