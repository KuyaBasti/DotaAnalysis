"""Economy realism: sim vs real team net worth at fixed checkpoints.

The engine's absolute gold was calibrated against parsed Divine matches
(data/details). This module keeps that honest: it extracts team net worth at
checkpoint minutes from both real parsed matches and sim timelines, so
dm-calibrate can report the gap and future engine changes can't silently
drift the economy again.
"""

from __future__ import annotations

import glob
import json
import statistics
from pathlib import Path
from typing import Any

from dm_pipeline import config

CHECKPOINT_MINUTES = (10, 20)


def timeline_team_networth(timeline: Any, minute: int) -> float | None:
    """Mean team net worth at ``minute`` from a sim timeline (None if too short)."""
    t = minute * 60
    for event in timeline.events:
        if event.type.value == "economy" and event.t == t:
            payload = event.payload
            return (payload["radiant_net_worth"] + payload["dire_net_worth"]) / 2.0
    return None


def real_team_networth(
    details_dir: Path | str | None = None,
    minutes: tuple[int, ...] = CHECKPOINT_MINUTES,
) -> dict[int, float]:
    """Mean team net worth per checkpoint from parsed matches ({} if none)."""
    details_dir = Path(details_dir) if details_dir is not None else config.DETAILS_DIR
    sums: dict[int, list[float]] = {m: [] for m in minutes}
    for path in glob.glob(str(details_dir / "*.json")):
        if "_unparsed" in path:
            continue
        detail = json.loads(Path(path).read_text())
        players = detail.get("players") or []
        if len(players) != 10 or not players[0].get("gold_t"):
            continue
        for side_is_radiant in (True, False):
            team = [
                p for p in players
                if (p.get("player_slot", 0) < 128) == side_is_radiant
            ]
            if len(team) != 5:
                continue
            for minute in minutes:
                if all(len(p["gold_t"]) > minute for p in team):
                    sums[minute].append(sum(p["gold_t"][minute] for p in team))
    return {m: statistics.mean(v) for m, v in sums.items() if v}


def economy_comparison(
    records: list[dict[str, Any]],
    details_dir: Path | str | None = None,
) -> dict[str, Any] | None:
    """Sim-vs-real checkpoint gaps, or None when either side lacks data.

    ``records`` are run_sim_corpus records carrying ``sim_networth_at``.
    """
    real = real_team_networth(details_dir)
    if not real:
        return None

    checkpoints: dict[str, dict[str, float]] = {}
    for minute, real_mean in sorted(real.items()):
        values = [
            r["sim_networth_at"][minute]
            for r in records
            if r.get("sim_networth_at", {}).get(minute) is not None
        ]
        if not values:
            continue
        sim_mean = statistics.mean(values)
        checkpoints[str(minute)] = {
            "sim": round(sim_mean, 1),
            "real": round(real_mean, 1),
            "ratio": round(sim_mean / real_mean, 3),
        }
    return checkpoints or None
