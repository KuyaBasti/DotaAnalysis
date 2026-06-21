"""Compare simulated outcomes against reality.

Given per-match predictions (the sim's radiant win rate vs. the real result),
compute the headline calibration metrics: accuracy and Brier score, against the
base rate. This is the number that turns "is the sim any good?" from a vibe into
a measurement.
"""

from __future__ import annotations

from typing import Any


def calibration_metrics(
    predictions: list[dict[str, Any]],
    *,
    prob_key: str = "sim_radiant_winrate",
    actual_key: str = "actual_radiant_win",
) -> dict[str, float | int]:
    """Accuracy + Brier of predicted radiant win probability vs. actual outcome.

    Each prediction needs ``prob_key`` (a probability in [0, 1]) and
    ``actual_key`` (truthy if radiant actually won).
    """
    n = len(predictions)
    if n == 0:
        return {"n": 0}

    correct = 0
    brier = 0.0
    radiant_wins = 0
    for p in predictions:
        prob = float(p[prob_key])
        actual = bool(p[actual_key])
        if (prob >= 0.5) == actual:
            correct += 1
        brier += (prob - (1.0 if actual else 0.0)) ** 2
        radiant_wins += int(actual)

    return {
        "n": n,
        "base_rate": round(radiant_wins / n, 4),  # actual radiant win rate
        "accuracy": round(correct / n, 4),
        "brier": round(brier / n, 4),  # 0 = perfect, 0.25 = always guess 0.5
    }
