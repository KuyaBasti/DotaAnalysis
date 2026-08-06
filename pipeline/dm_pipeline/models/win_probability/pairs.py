"""Hero-pair terms: synergy and counters on top of the per-hero model.

The per-hero model is additive, which has a consequence that shows up the moment
you try to give advice: adding a hero contributes the same weight no matter who
else is drafted, so "best next pick" collapses to argmax(weight) — a tier list,
not draft advice. Pair terms are what make a candidate's value depend on the
draft around it.

Three feature blocks, all **antisymmetric** under swapping sides (so the model
carries no side bias beyond the intercept, exactly like the hero encoding):

    hero    h      +1 on radiant, -1 on dire
    synergy {a,b}  +1 both on radiant, -1 both on dire
    counter {a,b}  +1 if a radiant & b dire, -1 if a dire & b radiant   (a < b)

**Pair weights are trained blended, never per bracket.** Measured: blended gives
+0.0109 AUC (sd 0.0016 over 5 splits, all positive), but training pairs inside a
single bracket fits noise — low +0.0035 (sd 0.0025), high +0.0038 (sd 0.0057,
one split negative). ~16k pair features against a bracket's ~10k matches is too
thin. So the shipped form is a hybrid: **per-bracket hero weights + blended pair
weights**, combined with a per-bracket weighting ``alpha``:

    log-odds = intercept + hero_w[bracket] . x_hero + alpha[bracket] * pair_w . x_pair

``alpha`` absorbs the scale difference between two separately-fit models. It is
tuned on a validation split, and the optimum is flat (2–3), so it is not a
sensitive knob.

**Then the result must be re-calibrated, and this is the trap.** ``alpha`` is
chosen on AUC, which is rank-based and completely blind to probability scale, so
the combined score ranks better while drifting off the log-odds scale — the raw
hybrid is *more over-confident* than the hero model (mean |p−0.5| 0.097 → 0.135
blended) and its Brier is worse, even though its AUC is better. A one-dimensional
Platt rescale fitted on validation, ``p = sigmoid(a * combined + b)``, restores
it: Brier then beats hero-only at every bracket, and being monotone it leaves
AUC untouched. Brier is the gate here, exactly as in AGENTS.md.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
from scipy import sparse
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

from dm_pipeline import config
from dm_pipeline.features.brackets import ALL_BRACKETS, BRACKET_KEYS, bracket_bounds

# Regularization for the pair block. ~300x stronger than the hero-only model's
# (C≈0.1): 16k pair features on a 59k-match corpus, median 104 observations per
# pair, so they need holding down hard. Swept 0.00003..0.01; optimum interior.
PAIR_C = 0.003
HERO_C = 0.1
# Weighting of the blended pair score per bracket, tuned on validation.
ALPHA_GRID = (0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 9.0)
# Below this a pair weight is noise; dropping them keeps the artifact small.
WEIGHT_EPSILON = 1e-4


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def _condensed(i: int, j: int, n: int) -> int:
    """Flat index of the unordered pair (i < j) in an upper-triangle array."""
    return i * (2 * n - i - 1) // 2 + (j - i - 1)


@dataclass
class PairMatrix:
    X: sparse.csr_matrix  # [hero block | synergy block | counter block]
    y: np.ndarray
    hero_ids: list[int]
    tiers: np.ndarray  # avg_rank_tier per row, for bracket masks
    n_heroes: int
    n_pairs: int


def build_pair_matrix(features_dir: Path | str | None = None) -> PairMatrix:
    """Blended design matrix with hero, synergy and counter blocks."""
    features_dir = (
        Path(features_dir) if features_dir is not None else config.FEATURES_DIR
    )
    matches = pl.read_parquet(features_dir / "matches.parquet")
    heroes = pl.read_parquet(features_dir / "match_heroes.parquet")

    hero_ids = sorted(heroes["hero_id"].unique().to_list())
    col = {h: j for j, h in enumerate(hero_ids)}
    n = len(hero_ids)
    n_pairs = n * (n - 1) // 2

    row_of = {m: i for i, m in enumerate(matches["match_id"].to_list())}
    sides: dict[int, tuple[list[int], list[int]]] = {}
    for mid, team, hid in heroes.select("match_id", "team", "hero_id").iter_rows():
        if mid not in row_of:
            continue
        rad, dire = sides.setdefault(mid, ([], []))
        (rad if team == "radiant" else dire).append(col[hid])

    rows: list[int] = []
    cols: list[int] = []
    vals: list[float] = []
    syn_off, cnt_off = n, n + n_pairs
    for mid, (rad, dire) in sides.items():
        if len(rad) != 5 or len(dire) != 5:
            continue  # malformed record; the feature store should exclude these
        i = row_of[mid]
        for c in rad:
            rows.append(i), cols.append(c), vals.append(1.0)
        for c in dire:
            rows.append(i), cols.append(c), vals.append(-1.0)
        for side, sign in ((rad, 1.0), (dire, -1.0)):
            for a, b in combinations(sorted(side), 2):
                rows.append(i)
                cols.append(syn_off + _condensed(a, b, n))
                vals.append(sign)
        for a in rad:
            for b in dire:
                lo, hi = (a, b) if a < b else (b, a)
                rows.append(i)
                cols.append(cnt_off + _condensed(lo, hi, n))
                vals.append(1.0 if a < b else -1.0)

    X = sparse.csr_matrix(
        (vals, (rows, cols)),
        shape=(matches.height, n + 2 * n_pairs),
        dtype=np.float32,
    )
    return PairMatrix(
        X=X,
        y=matches["radiant_win"].cast(pl.Int8).to_numpy(),
        hero_ids=hero_ids,
        tiers=matches["avg_rank_tier"].fill_null(0).to_numpy(),
        n_heroes=n,
        n_pairs=n_pairs,
    )


@dataclass
class PairResult:
    synergy: list[tuple[int, int, float]]  # (hero_id_a, hero_id_b, weight), a < b
    counter: list[tuple[int, int, float]]  # a on radiant vs b on dire, a < b
    alpha: dict[str, float]
    # Per-bracket Platt rescale (a, b) applied to the combined score.
    calibration: dict[str, tuple[float, float]] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)


def train_pairs(
    features_dir: Path | str | None = None, *, seed: int = 42
) -> PairResult:
    """Fit blended pair weights and tune the per-bracket alpha.

    One global split does everything, so the pair model never sees any bracket's
    evaluation rows: weights fit on train (60%), alpha tuned on val (20%),
    reported AUCs measured on test (20%).
    """
    pm = build_pair_matrix(features_dir)
    idx = np.arange(pm.X.shape[0])
    tr, tmp = train_test_split(idx, test_size=0.4, random_state=seed, stratify=pm.y)
    va, te = train_test_split(
        tmp, test_size=0.5, random_state=seed, stratify=pm.y[tmp]
    )

    joint = LogisticRegression(max_iter=2000, C=PAIR_C).fit(pm.X[tr], pm.y[tr])
    pair_w = joint.coef_[0][pm.n_heroes :]
    pair_score = np.asarray(pm.X[:, pm.n_heroes :] @ pair_w).ravel()

    alpha: dict[str, float] = {}
    calibration: dict[str, tuple[float, float]] = {}
    per_bracket: dict[str, Any] = {}
    for bracket in (ALL_BRACKETS, *BRACKET_KEYS):
        lo, hi = bracket_bounds(bracket)
        mask = (pm.tiers >= lo) & (pm.tiers < hi)
        b_tr, b_va, b_te = tr[mask[tr]], va[mask[va]], te[mask[te]]
        if len(b_tr) < 500 or len(b_va) < 200 or len(b_te) < 200:
            alpha[bracket] = 0.0  # not enough data to justify a pair term
            continue

        hero_m = LogisticRegression(max_iter=2000, C=HERO_C).fit(
            pm.X[b_tr][:, : pm.n_heroes], pm.y[b_tr]
        )
        intercept = float(hero_m.intercept_[0])

        def hero_score(rows: np.ndarray) -> np.ndarray:
            return (
                np.asarray(pm.X[rows][:, : pm.n_heroes] @ hero_m.coef_[0]).ravel()
                + intercept
            )

        best_a, best_val = 0.0, -1.0
        for a in ALPHA_GRID:
            auc = roc_auc_score(pm.y[b_va], hero_score(b_va) + a * pair_score[b_va])
            if auc > best_val:
                best_a, best_val = a, auc

        # alpha was picked on AUC, which cannot see probability scale — rescale
        # the combined score back onto the log-odds scale before it is served.
        combined_va = (hero_score(b_va) + best_a * pair_score[b_va]).reshape(-1, 1)
        platt = LogisticRegression(max_iter=1000).fit(combined_va, pm.y[b_va])
        cal_a = float(platt.coef_[0][0])
        cal_b = float(platt.intercept_[0])

        combined_te = hero_score(b_te) + best_a * pair_score[b_te]
        p_hero = _sigmoid(hero_score(b_te))
        p_raw = _sigmoid(combined_te)
        p_cal = _sigmoid(cal_a * combined_te + cal_b)

        alpha[bracket] = best_a
        calibration[bracket] = (round(cal_a, 6), round(cal_b, 6))
        per_bracket[bracket] = {
            "alpha": best_a,
            "calibration": [round(cal_a, 4), round(cal_b, 4)],
            "hero_only_auc": round(roc_auc_score(pm.y[b_te], p_hero), 4),
            "hybrid_auc": round(roc_auc_score(pm.y[b_te], p_cal), 4),
            "gain": round(
                roc_auc_score(pm.y[b_te], p_cal)
                - roc_auc_score(pm.y[b_te], p_hero),
                4,
            ),
            # Brier is the gate: the raw hybrid is worse-calibrated than
            # hero-only despite ranking better, and the rescale is what fixes it.
            "hero_only_brier": round(brier_score_loss(pm.y[b_te], p_hero), 4),
            "hybrid_raw_brier": round(brier_score_loss(pm.y[b_te], p_raw), 4),
            "hybrid_brier": round(brier_score_loss(pm.y[b_te], p_cal), 4),
            "n_test": int(len(b_te)),
        }

    synergy = _unpack(pair_w[: pm.n_pairs], pm.hero_ids)
    counter = _unpack(pair_w[pm.n_pairs :], pm.hero_ids)
    return PairResult(
        synergy=synergy,
        counter=counter,
        alpha=alpha,
        calibration=calibration,
        metrics={
            "n_train": int(len(tr)),
            "n_val": int(len(va)),
            "n_test": int(len(te)),
            "pair_C": PAIR_C,
            "n_synergy_kept": len(synergy),
            "n_counter_kept": len(counter),
            "brackets": per_bracket,
        },
    )


def _unpack(
    weights: np.ndarray, hero_ids: list[int]
) -> list[tuple[int, int, float]]:
    """Condensed weight array -> (hero_id_a, hero_id_b, weight), noise dropped."""
    n = len(hero_ids)
    out: list[tuple[int, int, float]] = []
    k = 0
    for i in range(n):
        for j in range(i + 1, n):
            w = float(weights[k])
            k += 1
            if abs(w) >= WEIGHT_EPSILON:
                out.append((hero_ids[i], hero_ids[j], round(w, 6)))
    return out


PAIRS_STEM = "win_probability.pairs"


def save_pairs(
    result: PairResult, out_dir: Path | str | None = None
) -> dict[str, Any]:
    """Write the servable pair coefficients + a metrics JSON."""
    out_dir = Path(out_dir) if out_dir is not None else config.MODELS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    # Hero *ids*, not column indices: the artifact is self-describing, so the
    # API can't drift from the trainer's ordering.
    (out_dir / f"{PAIRS_STEM}.coef.json").write_text(
        json.dumps(
            {
                "synergy": [list(t) for t in result.synergy],
                "counter": [list(t) for t in result.counter],
                "alpha": result.alpha,
                "calibration": {k: list(v) for k, v in result.calibration.items()},
            }
        )
    )
    (out_dir / f"{PAIRS_STEM}.metrics.json").write_text(
        json.dumps(result.metrics, indent=2)
    )
    return result.metrics
