"""Inference for the draft -> win-probability model.

Loads the trained logistic-regression bundle and scores a draft (lists of hero
ids) into P(radiant wins). Kept separate from training so consumers (e.g. the
sim's draft prior) don't pull in the training machinery.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from dm_pipeline import config


def load_win_prob_model(models_dir: Path | str | None = None) -> dict[str, Any]:
    """Load the trained bundle ({'model', 'hero_ids'}) from disk."""
    import joblib

    models_dir = Path(models_dir) if models_dir is not None else config.MODELS_DIR
    return joblib.load(models_dir / "win_probability.joblib")


def draft_to_vector(
    radiant_ids: list[int], dire_ids: list[int], hero_ids: list[int]
) -> np.ndarray:
    """Encode a draft as +1 radiant / -1 dire / 0 absent over the model's heroes.

    Heroes not in the model's vocabulary (never seen in training) contribute 0.
    """
    index = {hero_id: j for j, hero_id in enumerate(hero_ids)}
    x = np.zeros(len(hero_ids), dtype=np.float32)
    for hero_id in radiant_ids:
        j = index.get(hero_id)
        if j is not None:
            x[j] = 1.0
    for hero_id in dire_ids:
        j = index.get(hero_id)
        if j is not None:
            x[j] = -1.0
    return x


def predict_draft(
    bundle: dict[str, Any], radiant_ids: list[int], dire_ids: list[int]
) -> float:
    """Return P(radiant wins) for a draft, per the trained model."""
    x = draft_to_vector(radiant_ids, dire_ids, bundle["hero_ids"])
    return float(bundle["model"].predict_proba(x.reshape(1, -1))[0, 1])
