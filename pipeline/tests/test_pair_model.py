"""Tests for the synergy/counter (hero-pair) terms."""

from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import numpy as np
import polars as pl

from dm_pipeline.models.win_probability.pairs import (
    PAIRS_STEM,
    WEIGHT_EPSILON,
    _condensed,
    _unpack,
    build_pair_matrix,
    save_pairs,
    train_pairs,
)

RADIANT_POOL = list(range(1, 11))
DIRE_POOL = list(range(11, 21))


def _write(tmp_path: Path, matches: list[dict], hero_rows: list[dict]) -> Path:
    fd = tmp_path / "features"
    fd.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(matches).write_parquet(fd / "matches.parquet")
    pl.DataFrame(hero_rows).write_parquet(fd / "match_heroes.parquet")
    return fd


FILLERS = list(range(3, 15))

# (heroes on radiant, heroes on dire, radiant_win). Heroes 1 and 2 win *together*
# and are worthless apart — and the six cases are balanced so that each of them,
# on its own, sits on the winning side exactly half the time. That cancels both
# marginals, so an additive model has nothing to grip: fitting "1 alone loses"
# needs w1 < 0, fitting "1 and 2 together win" needs w1 + w2 > 0, and fitting
# "2 alone loses" needs w2 < 0 — a contradiction. The synergy term has no such
# problem.
_PAIR_CASES = (
    ([1, 2], [], True),   # together on radiant  -> radiant wins
    ([], [1, 2], False),  # together on dire     -> dire wins
    ([1], [], False),     # 1 alone on radiant   -> radiant loses
    ([], [1], True),      # 1 alone on dire      -> dire loses
    ([2], [], False),     # 2 alone on radiant   -> radiant loses
    ([], [2], True),      # 2 alone on dire      -> dire loses
)


def _pair_driven_dataset(tmp_path: Path, n: int = 1800) -> Path:
    """Outcome driven by a *pair*, with both heroes individually neutral."""
    rng = np.random.default_rng(0)
    matches: list[dict] = []
    hero_rows: list[dict] = []
    for match_id in range(n):
        rad_seed, dire_seed, radiant_win = _PAIR_CASES[match_id % len(_PAIR_CASES)]
        filler = list(rng.permutation(FILLERS))
        radiant = list(rad_seed) + filler[: 5 - len(rad_seed)]
        rest = filler[5 - len(rad_seed) :]
        dire = list(dire_seed) + rest[: 5 - len(dire_seed)]

        matches.append(
            {
                "match_id": match_id,
                "start_time": 0,
                "duration": 1800,
                "game_mode": 22,
                "lobby_type": 7,
                "avg_rank_tier": 45,  # all in the 'mid' band
                "radiant_win": radiant_win,
            }
        )
        for h in radiant:
            hero_rows.append({"match_id": match_id, "team": "radiant", "hero_id": h})
        for h in dire:
            hero_rows.append({"match_id": match_id, "team": "dire", "hero_id": h})
    return _write(tmp_path, matches, hero_rows)


def _simple_dataset(tmp_path: Path, n: int = 8) -> Path:
    matches, hero_rows = [], []
    for match_id in range(n):
        matches.append(
            {
                "match_id": match_id,
                "start_time": 0,
                "duration": 1800,
                "game_mode": 22,
                "lobby_type": 7,
                "avg_rank_tier": 45,
                "radiant_win": match_id % 2 == 0,
            }
        )
        for h in RADIANT_POOL[:5]:
            hero_rows.append({"match_id": match_id, "team": "radiant", "hero_id": h})
        for h in DIRE_POOL[:5]:
            hero_rows.append({"match_id": match_id, "team": "dire", "hero_id": h})
    return _write(tmp_path, matches, hero_rows)


def test_condensed_index_is_a_bijection() -> None:
    n = 12
    seen = [_condensed(i, j, n) for i, j in combinations(range(n), 2)]
    assert sorted(seen) == list(range(n * (n - 1) // 2))


def test_each_match_encodes_10_heroes_20_synergies_25_counters(tmp_path) -> None:
    pm = build_pair_matrix(_simple_dataset(tmp_path, n=4))
    row = pm.X[0]
    hero = row[:, : pm.n_heroes]
    syn = row[:, pm.n_heroes : pm.n_heroes + pm.n_pairs]
    cnt = row[:, pm.n_heroes + pm.n_pairs :]
    assert hero.nnz == 10  # 5 per side
    assert syn.nnz == 20  # two teams of C(5,2)
    assert cnt.nnz == 25  # every radiant hero against every dire hero


def test_features_are_antisymmetric_under_swapping_sides(tmp_path) -> None:
    """Swapping the two teams must negate every feature.

    This is what keeps the model free of side bias: swapping sides has to map
    P(radiant) to 1 - P(radiant), which only holds if the encoding flips sign.
    """
    matches, straight, swapped = [], [], []
    for match_id in range(2):
        matches.append(
            {
                "match_id": match_id,
                "start_time": 0,
                "duration": 1800,
                "game_mode": 22,
                "lobby_type": 7,
                "avg_rank_tier": 45,
                "radiant_win": True,
            }
        )
    for h in RADIANT_POOL[:5]:
        straight.append({"match_id": 0, "team": "radiant", "hero_id": h})
        swapped.append({"match_id": 1, "team": "dire", "hero_id": h})
    for h in DIRE_POOL[:5]:
        straight.append({"match_id": 0, "team": "dire", "hero_id": h})
        swapped.append({"match_id": 1, "team": "radiant", "hero_id": h})

    pm = build_pair_matrix(_write(tmp_path, matches, straight + swapped))
    a = pm.X[0].toarray().ravel()
    b = pm.X[1].toarray().ravel()
    assert np.allclose(a, -b)


def test_unpack_maps_to_hero_ids_and_drops_noise() -> None:
    hero_ids = [7, 9, 11]  # 3 heroes => 3 pairs, in condensed order
    weights = np.array([0.5, WEIGHT_EPSILON / 2, -0.25])
    assert _unpack(weights, hero_ids) == [(7, 9, 0.5), (9, 11, -0.25)]


def test_pair_terms_beat_the_additive_model_on_a_pair_driven_outcome(tmp_path) -> None:
    result = train_pairs(_pair_driven_dataset(tmp_path), seed=1)
    mid = result.metrics["brackets"]["mid"]

    # The whole reason pair terms exist: an additive model cannot express
    # "these two win *together*". Here it is left at chance while the pair
    # terms recover almost all of the signal.
    assert mid["hero_only_auc"] < 0.60
    assert mid["hybrid_auc"] > 0.85
    assert result.alpha["mid"] > 0


def test_brackets_without_enough_data_get_no_pair_term(tmp_path) -> None:
    # The fixture is entirely in the 'mid' band, so low/high can't be tuned.
    result = train_pairs(_pair_driven_dataset(tmp_path), seed=1)
    assert result.alpha["low"] == 0.0
    assert result.alpha["high"] == 0.0


def test_saved_coefficients_are_keyed_by_hero_id(tmp_path) -> None:
    result = train_pairs(_pair_driven_dataset(tmp_path), seed=1)
    save_pairs(result, out_dir=tmp_path)
    coef = json.loads((tmp_path / f"{PAIRS_STEM}.coef.json").read_text())

    assert set(coef) == {"synergy", "counter", "alpha", "calibration"}
    known = set(RADIANT_POOL) | set(DIRE_POOL)
    for a, b, w in coef["synergy"]:
        # Hero ids, not column indices — the artifact is self-describing so the
        # API cannot drift from the trainer's ordering.
        assert a in known and b in known and a < b
        assert isinstance(w, float)
    assert coef["alpha"]["mid"] > 0
    # A rescale ships alongside alpha, or the served probabilities drift off
    # the log-odds scale (alpha is chosen on AUC, which can't see scale).
    scale, _offset = coef["calibration"]["mid"]
    assert scale > 0


def test_rescaling_beats_the_raw_hybrid_on_brier(tmp_path) -> None:
    # AUC is blind to probability scale, so the raw hybrid can rank better
    # while being worse-calibrated. Brier is the gate; the rescale is what
    # makes the hybrid pass it.
    metrics = train_pairs(_pair_driven_dataset(tmp_path), seed=1).metrics
    mid = metrics["brackets"]["mid"]
    assert mid["hybrid_brier"] < mid["hybrid_raw_brier"]
    assert mid["hybrid_brier"] < mid["hero_only_brier"]
