"""Per-hero farm-timing signatures from parsed gold curves — `dm-trajectories`.

The timing-windows feature needs, per hero, an outcome-clean answer to "when
does this hero's share of their team's gold engine peak?". The method survived
an adversarial review that killed its first draft, and both repairs from that
review are load-bearing here:

1. **Within-TEAM share.** A hero's gold at minute m is divided by their own
   team's five-player total — never the 10-player lobby total. Team shares are
   zero-sum per team, so the winning team's growing gold lead cannot enter the
   feature *by construction* (the lobby-total version leaked outcome at
   corr = +0.37).
2. **Outcome-balanced means.** Every per-hero statistic is
   (mean over wins + mean over losses) / 2, so a hero's win rate cannot weight
   their curve. Requires both strata; a hero with too few wins or losses at a
   minute reports null there rather than a biased number.

The scaling delta (share@25 − share@5, within one game) is the headline timing
axis. Its measured single-game reliability (~0.095) sets the coverage gate:
GATE_MIN_SCALING_GAMES scaling-bearing games ≈ split-half reliability 0.8. The
artifact carries each hero's gate flag so consumers never re-derive the
threshold.

Scope, honestly: this measures **farm** timing — when a hero claims a growing
or shrinking slice of their team's economy — not *win* timing. The two
measurably diverge (KotL wins early yet farms late). Consumers must phrase it
as the gold engine, never as "when you win".
"""

from __future__ import annotations

import glob
import json
import statistics
from collections import defaultdict
from pathlib import Path

from dm_pipeline import config

MINUTES = (5, 10, 15, 20, 25, 30)
MIN_DURATION = 15 * 60  # drop abandons/non-games
MIN_STRATUM = 3  # a balanced mean needs at least this many wins AND losses
# Scaling-bearing games (>=25m, both strata present) for split-half
# reliability ~0.8 at the measured single-game reliability of ~0.095.
GATE_MIN_SCALING_GAMES = 38

ARTIFACT_NAME = "hero_trajectories.json"


def _balanced(wins: list[float], losses: list[float]) -> float | None:
    """Outcome-balanced mean; None when either stratum is too thin to trust."""
    if len(wins) < MIN_STRATUM or len(losses) < MIN_STRATUM:
        return None
    return (statistics.mean(wins) + statistics.mean(losses)) / 2


def extract_observations(
    details_dir: Path | str | None = None,
) -> tuple[dict[int, dict], int]:
    """Per-hero win/loss-stratified team-share observations from parsed details.

    Returns (per-hero data, games used). Each hero's entry holds, per minute,
    the list of within-team shares split by outcome, plus per-game scaling
    deltas split the same way.
    """
    details_dir = (
        Path(details_dir) if details_dir is not None else config.DETAILS_DIR
    )
    heroes: dict[int, dict] = defaultdict(
        lambda: {
            "share": {m: {"w": [], "l": []} for m in MINUTES},
            "scaling": {"w": [], "l": []},
        }
    )
    used = 0
    for path in sorted(glob.glob(str(Path(details_dir) / "*.json"))):
        if "_unparsed" in path:
            continue
        d = json.loads(Path(path).read_text())
        players = d.get("players") or []
        if d.get("duration", 0) < MIN_DURATION or len(players) != 10:
            continue
        if any(not p.get("gold_t") for p in players):
            continue
        used += 1
        max_m = min(len(p["gold_t"]) for p in players) - 1
        rad_won = bool(d.get("radiant_win"))
        for side in (True, False):
            team = [p for p in players if p["isRadiant"] == side]
            if len(team) != 5:
                continue
            won = "w" if side == rad_won else "l"
            totals = {}
            for m in MINUTES:
                if m <= max_m:
                    t = sum(p["gold_t"][m] for p in team)
                    if t > 0:
                        totals[m] = t
            for p in team:
                h = heroes[p["hero_id"]]
                for m, t in totals.items():
                    h["share"][m][won].append(p["gold_t"][m] / t)
                if 5 in totals and 25 in totals:
                    h["scaling"][won].append(
                        p["gold_t"][25] / totals[25] - p["gold_t"][5] / totals[5]
                    )
    return dict(heroes), used


def build_trajectories(details_dir: Path | str | None = None) -> dict:
    """The servable artifact: per-hero balanced curve + scaling + gate flag.

    Keys are hero *ids* (as strings, being JSON) — self-describing, the same
    convention as the pair-weights artifact, so consumers can't drift on
    ordering.
    """
    observations, used = extract_observations(details_dir)
    out: dict[str, dict] = {}
    for hero_id, h in observations.items():
        curve = [
            _balanced(h["share"][m]["w"], h["share"][m]["l"]) for m in MINUTES
        ]
        n_scaling = len(h["scaling"]["w"]) + len(h["scaling"]["l"])
        scaling = _balanced(h["scaling"]["w"], h["scaling"]["l"])
        out[str(hero_id)] = {
            "curve": [round(v, 5) if v is not None else None for v in curve],
            "scaling": round(scaling, 5) if scaling is not None else None,
            "n_scaling": n_scaling,
            "gated": scaling is not None and n_scaling >= GATE_MIN_SCALING_GAMES,
        }
    return {
        "minutes": list(MINUTES),
        "games_used": used,
        "gate_min_scaling_games": GATE_MIN_SCALING_GAMES,
        "heroes": out,
    }


def save_trajectories(
    artifact: dict, out_dir: Path | str | None = None
) -> Path:
    out_dir = Path(out_dir) if out_dir is not None else config.MODELS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / ARTIFACT_NAME
    path.write_text(json.dumps(artifact))
    return path


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract per-hero farm-timing curves from parsed details.",
    )
    parser.parse_args(argv)

    artifact = build_trajectories()
    path = save_trajectories(artifact)
    heroes = artifact["heroes"]
    gated = sum(1 for h in heroes.values() if h["gated"])
    print(
        f"{artifact['games_used']} games -> {len(heroes)} heroes, "
        f"{gated} clear the {artifact['gate_min_scaling_games']}-game gate"
    )
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
