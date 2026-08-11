# Progress log

Living record of what's shipped. Newest first. Keep it updated as verticals land
(one entry per merged PR or coherent chunk). Metrics are the last measured values;
re-run `dm-calibrate --sample 2000` after engine changes.

## Where things stand

- **73 PRs merged.** The core loop works end-to-end: **draft → predict → simulate
  → watch → analyze → understand → act**, all of it **at the rank bracket you
  play**, and every realism issue from the audits is closed.
- **Engine:** a full, watchable ranked game — real (Divine-calibrated) economy,
  laning, teamfights with named casualties + K/D/A, Roshan, XP/levels, two-sided
  laned objectives → Ancient, and moving hero positions.
- **Calibration (n=2000):** Brier 0.296 (the win gate, best measured), duration
  +0.8m of real, economy within ±1.3% of parsed real gold at min 10/20. The sim's
  draft-edge→win curve now tracks the one measured on 59,410 real matches to
  ~1pp.
- **Data:** 127k matches banked / **59.4k ranked** in the feature store (every
  bracket viable to train on). Parsed details (gold curves + purchase logs) sit
  at a few hundred and are **now growing on their own cron** — that corpus is
  the binding constraint on the rest of the roadmap.
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
| 7 Coach Lab | 🟡 **explanation + suggestions** (exit criterion met) · ⬜ timing windows |
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

**Draft suggestions — Coach Lab prescribes, not just diagnoses.** The
explanation panel told you Clockwerk was costing you five points and then had
nothing to say about what to do instead. `POST /analysis/suggest` scores every
undrafted hero for the side that's picking; Draft Studio lists them under the
breakdown, clickable to draft. All ~127 candidates are ~127 native sigmoid
evaluations, so it rides the live path with the win% bar — no button, no sim.
**Stage 7's exit criterion is met.**

The design changed because of a measurement taken before building the UI. The
stated risk was shipping a tier list wearing a coach's hat, so: rank by total
swing across five different boards and **6–9 of the top 10 hold** (Pugna and
Undying were top-2 in every one). The hero terms swamp the pair terms. Rank on
**fit** — the synergy/counter part alone — and **0–3 of 10 hold**. So the panel
ships both orderings with both numbers always visible, rather than presenting
the first as if it were the second. The case that proves the point: with Visage
drafted, Best fit surfaces Anti-Mage at **−2.2 pp total, +0.9 fit** — a hero
who is weak at that bracket and still pairs well, which no single ordering can
say.

**The last known bug: dark-mode readability.** The web app had no stylesheet at
all — all 133 colour literals live inline on components, every one assuming a
light page, and nothing ever set a page background. A browser preferring dark
mode painted its own dark canvas behind them, so everything outside a light
panel (header, intro line, rank label, drafted hero lists) rendered
dark-on-dark. The panels each set their own `#fafafa`, which is exactly why it
survived so long: the parts screenshotted during feature work always looked
fine. Fixed by committing the app to light — `color-scheme: light` plus an
explicit body background, the former mattering as much as the latter since the
UA otherwise keeps styling form controls for dark mode. Going genuinely
theme-aware would mean rehoming all 133 literals; that's a refactor, not a bug
fix. **No known defects remain.**

**Timing windows: investigated, not built — and the corpus is why.** Coach
Lab's last slice turned out to be unbuildable three different ways, which took
a spike to establish rather than a guess. **From the sim:** hero identity enters
the engine as one time-invariant scalar (`_POSITION_PRIORITIES` even hands every
team the same farm ladder), so curve *shape* regresses on strength edge at
R² = 0.877 with the residual being sigmoid saturation — every draft's story is
"the stronger side pulls away", only faster or slower. **From duration
buckets:** hero win rate does swing hugely with game length (sd 9.7 points,
Faceless Void +26.9, Keeper of the Light −16.9) but it is mostly a *stomp
artifact* — short games carry twice the win-rate spread of long ones
(sd 0.074 vs 0.037, long games compressed toward 50% because they are close
games by construction), and swing correlates −0.939 with the short-game rate
alone. It is one number wearing two hats. The same survivorship trap `dm-builds`
already had to dodge with duration-independent item thresholds. **From parsed
gold curves** — the honest, outcome-independent method — blocked on data:
**127 parsed matches** for 127 heroes.

So the binding constraint on the rest of the roadmap is the parsed corpus, not
code: timing windows *and* the fight-outcome model both need it. `dm-harvest`
had grown raw matches to 127k unattended on a 3-hour cron while `dm-backfill`
stayed manual, which is exactly why details never moved. It is now registered as
a console script and on its own cron (`30 1,7,13,19`, `--max 200`, ~60% parse
rate ⇒ ~480 new parsed matches a day). Kept at `--min-rank 70` deliberately:
`calibrate/economy.py` reads every file in `data/details/` without a rank
filter, so widening it would have moved a calibration gate silently. See
[runbooks/data-collection.md](runbooks/data-collection.md).

**A real design system for the web app.** The UI had been assembled rather than
designed: **no stylesheet at all**, 133 colour literals inline on components, a
760px centred column, and `<p style={{color:'crimson'}}>` for errors. Modelled
the fix on the sibling Centavo project's visual system — semantic tokens, a
sidebar shell, `card`/`stat`/`tag`/`note`/`btn`/`seg` primitives, a mono face
with tabular figures (gold, win% and K/D/A are all read in columns) — but with
DraftMaster's own identity. **Dark-first**, since this is a tool for a game
whose own UI is dark and every heavy surface (minimap, net-worth graph,
win-prob strip) reads better on a dark ground; a full light mode follows.
**Gold** is the brand accent: Radiant green and Dire red are fixed identities
that carry meaning, so the accent had to be a colour never mistaken for a team,
and gold is Dota's economy. `var()` resolves in SVG presentation attributes, so
the minimap and graphs re-theme with everything else instead of being pinned to
one background. Match Viewer became a dashboard rather than a document —
scoreboard, map and both graphs in cards, side by side. Supersedes the
light-mode stopgap: that was a bug fix for an app with no stylesheet, this is
the real answer. Inline style props ~190 → 53, and what remains is dynamic (bar
widths, positions). Four bugs surfaced just from looking at the result, one of
them older than the PR: the net-worth share bar painted **entirely Dire at
0:00**, because a clamped denominator made 0–0 read as 0% rather than even.

## Next — the additive roadmap

The engine's realism work is done; what's left adds new capability (nothing is a
fix). See [../SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md) for the map.

1. **Grow the parsed corpus** — now on a cron; nothing to do but let it run.
   Revisit the two items below when `data/details/` is in the thousands.
2. **Timing windows** (Stage 7's last slice) — *blocked on data*, and when it
   unblocks it should be built from per-minute gold trajectories (a within-game,
   outcome-independent measure), **not** from duration-bucketed win rates, which
   measure stomps. Note this removes the Rust port's last concrete trigger: the
   honest version reads parsed curves, it doesn't run the sim.
3. **Fight-outcome model** (Stage 6) — learn the fight resolver from parsed
   teamfight data instead of the analytic logistic. *Also blocked on the parsed
   corpus* — same constraint as item 2.
4. ~~Per-bracket amplification~~ — **investigated, not needed.** The table that
   motivated it was a measurement bug (see the arc entry above); measured
   properly the per-bracket slopes are flat, so one global constant is correct.
5. **Rust engine port** (Stage 3) — speed for large batch Monte-Carlo runs.
   **No current trigger:** the engine does 202 sims/sec, the product's heaviest
   path (200 sims) takes 1.0s, and timing windows — the one item that looked
   like it would need the sim — turns out not to. If speed is ever wanted,
   multiprocessing across cores is ~6–8× for a day's work, since sims are
   independent.
6. **Batch job queue** (Stage 4) — enqueue long runs rather than run inline.
