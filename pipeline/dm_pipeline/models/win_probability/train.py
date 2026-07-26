"""Train a draft -> win-probability model.

Encodes each match's draft as a per-hero vector (+1 if the hero is on radiant,
-1 if on dire, 0 if absent) and fits a logistic regression to predict
radiant_win. Interpretable (every hero gets a learned win-contribution weight)
and the right first model for a few-thousand-match corpus -- gradient boosting
would overfit ~130 features on so few games.

This is the Stage-1 feasibility bet made concrete: does hero composition predict
wins? The test AUC answers it directly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split

from dm_pipeline import config
from dm_pipeline.features.brackets import ALL_BRACKETS, bracket_bounds


def load_draft_matrix(
    features_dir: Path | str | None = None,
    *,
    bracket: str = ALL_BRACKETS,
) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Build (X, y, hero_ids) from the features dataset.

    X[i, j] = +1 if hero j is on radiant in match i, -1 if on dire, else 0.
    y[i]    = 1 if radiant won.

    ``bracket`` restricts training to one rank band (see features.brackets);
    the hero columns stay the full roster so every model shares a layout.
    """
    features_dir = (
        Path(features_dir) if features_dir is not None else config.FEATURES_DIR
    )
    matches = pl.read_parquet(features_dir / "matches.parquet")
    heroes = pl.read_parquet(features_dir / "match_heroes.parquet")

    hero_ids = sorted(heroes["hero_id"].unique().to_list())
    lo, hi = bracket_bounds(bracket)
    if bracket != ALL_BRACKETS:
        matches = matches.filter(
            (pl.col("avg_rank_tier").fill_null(0) >= lo)
            & (pl.col("avg_rank_tier").fill_null(0) < hi)
        )
    hero_col = {hero_id: j for j, hero_id in enumerate(hero_ids)}
    match_row = {mid: i for i, mid in enumerate(matches["match_id"].to_list())}

    X = np.zeros((matches.height, len(hero_ids)), dtype=np.float32)
    for row in heroes.iter_rows(named=True):
        i = match_row.get(row["match_id"])
        if i is None:
            continue
        X[i, hero_col[row["hero_id"]]] = 1.0 if row["team"] == "radiant" else -1.0

    y = matches["radiant_win"].cast(pl.Int8).to_numpy()
    return X, y, hero_ids


@dataclass
class TrainResult:
    auc: float
    accuracy: float
    n_train: int
    n_test: int
    n_heroes: int
    model: LogisticRegression
    hero_ids: list[int]


def train(
    features_dir: Path | str | None = None,
    *,
    test_size: float = 0.2,
    seed: int = 42,
    bracket: str = ALL_BRACKETS,
) -> TrainResult:
    X, y, hero_ids = load_draft_matrix(features_dir, bracket=bracket)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=seed, stratify=y
    )
    model = LogisticRegression(max_iter=1000)
    model.fit(X_train, y_train)

    proba = model.predict_proba(X_test)[:, 1]
    return TrainResult(
        auc=float(roc_auc_score(y_test, proba)),
        accuracy=float(accuracy_score(y_test, (proba >= 0.5).astype(int))),
        n_train=int(len(y_train)),
        n_test=int(len(y_test)),
        n_heroes=len(hero_ids),
        model=model,
        hero_ids=hero_ids,
    )


def model_basename(bracket: str = ALL_BRACKETS) -> str:
    """Artifact stem for a bracket. 'all' keeps the original (legacy) names."""
    return (
        "win_probability"
        if bracket == ALL_BRACKETS
        else f"win_probability.{bracket}"
    )


def save_model(
    result: TrainResult,
    out_dir: Path | str | None = None,
    *,
    bracket: str = ALL_BRACKETS,
) -> dict[str, Any]:
    """Persist the model + a metrics JSON. Returns the metrics."""
    import joblib

    out_dir = Path(out_dir) if out_dir is not None else config.MODELS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = model_basename(bracket)
    joblib.dump(
        {"model": result.model, "hero_ids": result.hero_ids},
        out_dir / f"{stem}.joblib",
    )
    metrics = {
        "bracket": bracket,
        "auc": round(result.auc, 4),
        "accuracy": round(result.accuracy, 4),
        "n_train": result.n_train,
        "n_test": result.n_test,
        "n_heroes": result.n_heroes,
    }
    (out_dir / f"{stem}.metrics.json").write_text(json.dumps(metrics, indent=2))

    # Servable coefficients: a consumer can score a draft directly as
    # sigmoid(intercept + weights . draft) without loading sklearn (the API does
    # exactly this for instant draft evaluation).
    coefficients = {
        "hero_ids": result.hero_ids,
        "weights": [round(float(w), 6) for w in result.model.coef_[0]],
        "intercept": round(float(result.model.intercept_[0]), 6),
    }
    (out_dir / f"{stem}.coef.json").write_text(json.dumps(coefficients))
    return metrics


def main(argv: list[str] | None = None) -> None:
    import argparse

    from dm_pipeline.features.brackets import BRACKET_KEYS, bracket_label

    parser = argparse.ArgumentParser(
        description="Train the draft->win model, per rank bracket.",
    )
    parser.add_argument(
        "--bracket",
        default="every",
        help=f"one of {ALL_BRACKETS}/{'/'.join(BRACKET_KEYS)}, or 'every' (default: train all)",
    )
    args = parser.parse_args(argv)

    targets = (
        [ALL_BRACKETS, *BRACKET_KEYS] if args.bracket == "every" else [args.bracket]
    )
    for bracket in targets:
        result = train(bracket=bracket)
        metrics = save_model(result, bracket=bracket)
        print(
            f"{bracket_label(bracket):16} AUC {metrics['auc']:.4f} | "
            f"acc {metrics['accuracy']:.4f} | "
            f"trained {metrics['n_train']:,}, tested {metrics['n_test']:,}"
        )


if __name__ == "__main__":
    main()
