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
# Where the gold-lead spread is compared. A diagnostic, not a gate: matching
# mean team gold says nothing about how far apart the two teams are, and the
# engine's leads once ran 4-6x wider than real games' while the totals matched
# within 2% — invisible to every number this harness used to print.
LEAD_SPREAD_MINUTES = (10, 15, 20)


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


def timeline_team_lead(timeline: Any, minute: int) -> float | None:
    """Radiant-minus-Dire net worth at ``minute`` from a sim timeline (None if too short)."""
    t = minute * 60
    for event in timeline.events:
        if event.type.value == "economy" and event.t == t:
            payload = event.payload
            return payload["radiant_net_worth"] - payload["dire_net_worth"]
    return None


def real_abs_leads(
    details_dir: Path | str | None = None,
    minutes: tuple[int, ...] = LEAD_SPREAD_MINUTES,
) -> dict[int, list[float]]:
    """|Radiant - Dire| team gold (``gold_t`` sums) per minute, one value per parsed match."""
    details_dir = Path(details_dir) if details_dir is not None else config.DETAILS_DIR
    out: dict[int, list[float]] = {m: [] for m in minutes}
    for path in glob.glob(str(details_dir / "*.json")):
        if "_unparsed" in path:
            continue
        detail = json.loads(Path(path).read_text())
        players = detail.get("players") or []
        if len(players) != 10 or not players[0].get("gold_t"):
            continue
        for minute in minutes:
            if not all(len(p.get("gold_t") or []) > minute for p in players):
                continue
            radiant = sum(p["gold_t"][minute] for p in players if p.get("player_slot", 0) < 128)
            dire = sum(p["gold_t"][minute] for p in players if p.get("player_slot", 0) >= 128)
            out[minute].append(abs(radiant - dire))
    return {m: v for m, v in out.items() if v}


def _quantile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def lead_spread_comparison(
    records: list[dict[str, Any]],
    details_dir: Path | str | None = None,
) -> dict[str, Any] | None:
    """Median and 90th-percentile |gold lead|, sim vs real, per minute; None without data.

    ``records`` are run_sim_corpus records carrying ``sim_lead_at`` (one value
    per simulated game, not a per-draft mean — a spread needs the games).
    """
    real = real_abs_leads(details_dir)
    if not real:
        return None
    out: dict[str, dict[str, float]] = {}
    for minute, real_values in sorted(real.items()):
        sims = [abs(v) for r in records for v in r.get("sim_lead_at", {}).get(minute, [])]
        if not sims:
            continue
        sim_median, real_median = statistics.median(sims), statistics.median(real_values)
        out[str(minute)] = {
            "sim_median": round(sim_median, 1),
            "real_median": round(real_median, 1),
            "sim_p90": round(_quantile(sims, 0.9), 1),
            "real_p90": round(_quantile(real_values, 0.9), 1),
            "ratio": round(sim_median / real_median, 2) if real_median else None,
        }
    return out or None
