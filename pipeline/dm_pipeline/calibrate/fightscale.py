"""Fit the fight resolver's affine scale against real teamfights.

The engine's fight logistic (``prototype/fight_v0.py``) uses
``scale = _PROB_SCALE_BASE + _PROB_SCALE_PER_TOTAL * total_map_net_worth``,
originally fit by MLE on 11,212 parsed teamfights. This module makes that fit
reproducible: run ``dm-fit-fightscale`` at each meta refresh to re-measure the
constants on the grown corpus and compare them against what the engine ships.
The shipped constants are pinned at two totals by ``tests/test_fights.py`` —
if a re-fit says they drifted, retune deliberately (constants + pin together),
never silently.

Methodology (pinned by the original fit's adversarial review):

- Features are strictly PRE-fight: per-player ``gold_t`` at minute
  ``floor(start / 60)`` — the last full minute at or before the fight starts.
- Label: the team with fewer deaths in the fight wins; equal-death fights are
  dropped. ``gold_delta`` is never a feature or label (it contains the
  fight's outcome).
- The held-out split is BY MATCH (``match_id % 5 == 0`` -> test): fights
  within one game share a winner-biased trajectory. The rule is deterministic,
  so test matches stay out-of-sample across re-fits on a grown corpus.
- Selection caveat: OpenDota records only multi-death brawls, so the fit
  extrapolates to smaller skirmishes; ``dm-calibrate`` gates the sim effect.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import optimize

from dm_pipeline import config
from dm_pipeline.prototype.fight_v0 import (
    _PROB_SCALE_BASE,
    _PROB_SCALE_PER_TOTAL,
)

# Fight-time buckets for the per-phase report (minutes).
BUCKETS = ((0, 10), (10, 20), (20, 30), (30, 99))
# Reference totals for the shipped-vs-fitted scale comparison (gold).
REFERENCE_TOTALS = (30_000, 100_000, 200_000)


@dataclass
class FightObservation:
    match_id: int
    minute: float
    nw_diff: float  # radiant minus dire, pre-fight
    total: float  # radiant plus dire, pre-fight
    radiant_won: bool  # fewer deaths in the fight


def extract_fights(details_dir: Path | str | None = None) -> list[FightObservation]:
    """Labeled teamfight observations from every parsed match on disk."""
    details_dir = Path(details_dir) if details_dir is not None else config.DETAILS_DIR
    rows: list[FightObservation] = []
    for path in sorted(glob.glob(str(details_dir / "*.json"))):
        # Ledger/metadata files (e.g. _unparsed.json) — match on the basename,
        # not the full path, which may legitimately contain an underscore.
        if Path(path).name.startswith("_"):
            continue
        detail = json.loads(Path(path).read_text())
        players = detail.get("players") or []
        match_id = detail.get("match_id")
        if len(players) != 10 or match_id is None:
            continue
        is_radiant = [(p.get("player_slot") or 0) < 128 for p in players]
        for fight in detail.get("teamfights") or []:
            start = fight.get("start")
            if start is None or start < 0:
                continue
            minute = int(start // 60)  # last full minute BEFORE the fight
            try:
                gold = [p["gold_t"][minute] for p in players]
            except (KeyError, IndexError, TypeError):
                continue
            fight_players = fight.get("players") or []
            if len(fight_players) != 10:
                continue
            radiant_gold = sum(g for g, r in zip(gold, is_radiant) if r)
            dire_gold = sum(g for g, r in zip(gold, is_radiant) if not r)
            radiant_deaths = sum(
                (fp.get("deaths") or 0) for fp, r in zip(fight_players, is_radiant) if r
            )
            dire_deaths = sum(
                (fp.get("deaths") or 0)
                for fp, r in zip(fight_players, is_radiant)
                if not r
            )
            if radiant_deaths == dire_deaths:
                continue  # no winner under the deaths label
            rows.append(
                FightObservation(
                    match_id=match_id,
                    minute=start / 60.0,
                    nw_diff=radiant_gold - dire_gold,
                    total=radiant_gold + dire_gold,
                    radiant_won=radiant_deaths < dire_deaths,
                )
            )
    return rows


def _probabilities(
    nw_diff: np.ndarray, total: np.ndarray, base: float, per_total: float
) -> np.ndarray:
    scale = base + per_total * total
    return 1.0 / (1.0 + np.exp(-np.clip(nw_diff / scale, -30.0, 30.0)))


def _brier(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


def is_test(match_id: np.ndarray) -> np.ndarray:
    """The deterministic held-out rule shared with the original fit."""
    return (match_id % 5) == 0


@dataclass
class FitResult:
    base: float
    per_total: float
    n_fights: int
    n_matches: int
    n_train: int
    n_test: int
    brier_test_fitted: float
    brier_test_shipped: float
    # (lo, hi, n_test, brier_shipped, brier_fitted) per fight-time bucket
    buckets: list[tuple[int, int, int, float, float]]


def fit(rows: list[FightObservation]) -> FitResult:
    """MLE of ``sigmoid(nw_diff / (base + per_total * total))`` on train matches."""
    y = np.array([1.0 if r.radiant_won else 0.0 for r in rows])
    nw = np.array([r.nw_diff for r in rows])
    total = np.array([r.total for r in rows])
    minute = np.array([r.minute for r in rows])
    match_id = np.array([r.match_id for r in rows])
    test = is_test(match_id)
    train = ~test
    if not train.any() or not test.any():
        # Without this, an all-NaN objective makes Nelder-Mead return x0 —
        # the tool would report the shipped constants as "fitted" (fake zero
        # drift), the worst failure mode a drift detector can have.
        raise ValueError(
            f"degenerate split: {int(train.sum())} train / {int(test.sum())} "
            "test fights — the match_id % 5 rule needs matches on both sides"
        )

    def negative_log_likelihood(params: np.ndarray) -> float:
        base, per_total = params
        scale = base + per_total * total[train]
        if np.any(scale <= 100.0):  # degenerate region; steer the search away
            return 1e9
        p = np.clip(
            _probabilities(nw[train], total[train], base, per_total), 1e-9, 1 - 1e-9
        )
        return -float(np.mean(y[train] * np.log(p) + (1 - y[train]) * np.log(1 - p)))

    start = np.array([_PROB_SCALE_BASE, _PROB_SCALE_PER_TOTAL])
    result = optimize.minimize(negative_log_likelihood, x0=start, method="Nelder-Mead")
    base, per_total = float(result.x[0]), float(result.x[1])

    p_fitted = _probabilities(nw, total, base, per_total)
    p_shipped = _probabilities(nw, total, _PROB_SCALE_BASE, _PROB_SCALE_PER_TOTAL)
    buckets = []
    for lo, hi in BUCKETS:
        sel = test & (minute >= lo) & (minute < hi)
        if not sel.any():
            buckets.append((lo, hi, 0, float("nan"), float("nan")))
            continue
        buckets.append(
            (lo, hi, int(sel.sum()), _brier(y[sel], p_shipped[sel]), _brier(y[sel], p_fitted[sel]))
        )
    return FitResult(
        base=base,
        per_total=per_total,
        n_fights=len(rows),
        n_matches=len(set(int(m) for m in match_id)),
        n_train=int(train.sum()),
        n_test=int(test.sum()),
        brier_test_fitted=_brier(y[test], p_fitted[test]),
        brier_test_shipped=_brier(y[test], p_shipped[test]),
        buckets=buckets,
    )


def report(result: FitResult) -> str:
    lines = [
        f"fights:   {result.n_fights} labeled, from {result.n_matches} parsed matches "
        f"(train {result.n_train} / test {result.n_test}, split by match_id % 5)",
        f"shipped:  scale = {_PROB_SCALE_BASE:,.0f} + {_PROB_SCALE_PER_TOTAL:.4f} * total"
        f"   held-out Brier {result.brier_test_shipped:.4f}",
        f"fitted:   scale = {result.base:,.0f} + {result.per_total:.4f} * total"
        f"   held-out Brier {result.brier_test_fitted:.4f}",
        "",
        "scale at reference totals (shipped -> fitted):",
    ]
    for total in REFERENCE_TOTALS:
        shipped = _PROB_SCALE_BASE + _PROB_SCALE_PER_TOTAL * total
        fitted = result.base + result.per_total * total
        drift = (fitted - shipped) / shipped * 100.0
        lines.append(
            f"  total {total:>7,}: {shipped:>7,.0f} -> {fitted:>7,.0f}  ({drift:+.1f}%)"
        )
    lines += ["", "held-out Brier by fight-time bucket (shipped | fitted):"]
    for lo, hi, n, shipped, fitted in result.buckets:
        if n == 0:
            lines.append(f"  min {lo:>2}-{hi:<2}: no test fights")
            continue
        lines.append(
            f"  min {lo:>2}-{hi:<2}: n={n:>5}   {shipped:.4f} | {fitted:.4f}"
        )
    lines += [
        "",
        "The shipped constants are pinned at two totals in tests/test_fights.py.",
        "If the fitted pair has drifted materially, retune deliberately: update",
        "the constants AND the pin together, then re-run dm-calibrate.",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-fit the fight resolver's affine scale on parsed teamfights."
    )
    parser.add_argument(
        "--details-dir",
        default=None,
        help="parsed match directory (default: data/details)",
    )
    args = parser.parse_args()
    rows = extract_fights(args.details_dir)
    if len(rows) < 1_000:
        print(
            f"only {len(rows)} labeled fights — the original fit used 11,212; "
            "a re-fit this thin would be noise. Grow data/details first."
        )
        raise SystemExit(1)
    print(report(fit(rows)))


if __name__ == "__main__":
    main()
