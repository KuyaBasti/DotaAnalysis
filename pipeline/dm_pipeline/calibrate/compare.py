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


def hero_winrate_correlation(
    records: list[dict[str, Any]], *, min_games: int = 20
) -> dict[str, Any]:
    """Correlation of per-hero *simulated* win rate vs. *real* win rate.

    The Stage-3 exit criterion (target r > 0.8): does the sim reproduce which
    heroes win, not just who wins a given game? Real and sim win rates are both
    computed over the sampled drafts so the comparison is apples-to-apples.
    """
    import numpy as np

    real: dict[int, list[float]] = {}  # hero_id -> [wins, games]
    sim: dict[int, list[float]] = {}
    for rec in records:
        radiant_won = rec["actual_radiant_win"]
        sim_radiant = rec["sim_radiant_winrate"]
        for hero_id in rec["radiant_ids"]:
            r = real.setdefault(hero_id, [0.0, 0.0]); r[0] += radiant_won; r[1] += 1
            s = sim.setdefault(hero_id, [0.0, 0.0]); s[0] += sim_radiant; s[1] += 1
        for hero_id in rec["dire_ids"]:
            r = real.setdefault(hero_id, [0.0, 0.0]); r[0] += not radiant_won; r[1] += 1
            s = sim.setdefault(hero_id, [0.0, 0.0]); s[0] += 1 - sim_radiant; s[1] += 1

    heroes = [h for h in real if real[h][1] >= min_games]
    if len(heroes) < 2:
        return {"r": None, "n_heroes": len(heroes)}
    real_wr = [real[h][0] / real[h][1] for h in heroes]
    sim_wr = [sim[h][0] / sim[h][1] for h in heroes]
    r = float(np.corrcoef(real_wr, sim_wr)[0, 1])
    return {"r": round(r, 4), "n_heroes": len(heroes)}


def duration_comparison(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Mean real vs. sim game duration (minutes). Stage-3 target: within ~3 min."""
    if not records:
        return {"n": 0}
    real = [rec["actual_duration"] for rec in records]
    sim = [d for rec in records for d in rec["sim_durations"]]
    real_mean = sum(real) / len(real)
    sim_mean = sum(sim) / len(sim)
    return {
        "real_mean_min": round(real_mean / 60, 1),
        "sim_mean_min": round(sim_mean / 60, 1),
        "gap_min": round((sim_mean - real_mean) / 60, 1),
    }
