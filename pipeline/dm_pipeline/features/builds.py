"""Extract real item builds and completion thresholds from parsed matches.

Turns the ``purchase_log`` in data/details/ into two things the engine needs to
narrate item timings:

1. **Per-hero builds** — which big items a hero actually buys, in the order real
   players complete them.
2. **Net-worth thresholds** — the net worth at which real players complete their
   k-th big item (measured against their own ``gold_t`` curve). Timing therefore
   falls out of the already-calibrated economy instead of being invented.

Small items (boots, consumables, components) are ignored: the feed narrates
*power spikes*, and the overhead they represent is already baked into the
measured thresholds.
"""

from __future__ import annotations

import glob
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from dm_pipeline import config

BIG_ITEM_MIN_COST = 2000  # gold; below this it's a component, not a spike
MAX_BUILD_LENGTH = 6  # how deep a build we model
MIN_HERO_SAMPLES = 4  # fewer games than this => fall back to the generic build
_MAX_THRESHOLD_K = 6  # measure thresholds for the first N big items


def _item_costs(snapshot: dict[str, Any]) -> dict[str, int]:
    return {i["key"]: (i.get("cost") or 0) for i in snapshot.get("items", [])}


def _item_names(snapshot: dict[str, Any]) -> dict[str, str]:
    return {i["key"]: i["display_name"] for i in snapshot.get("items", [])}


def _completion_thresholds(nw_owned: list[tuple[float, int]]) -> list[int]:
    """Net worth at which P(a real player owns >= k big items) crosses 0.5.

    Duration-independent (observations are sampled through every game), so it's
    unaffected by how long the sampled games happen to run. This is what the
    engine's _ITEM_NETWORTH_THRESHOLDS are set from.
    """
    if not nw_owned:
        return []
    ceiling = 40_000.0
    out: list[int] = []
    for k in range(1, _MAX_THRESHOLD_K + 1):
        lo, hi = 0.0, ceiling
        for _ in range(40):  # binary search on net worth
            mid = (lo + hi) / 2
            near = [owned for nw, owned in nw_owned if abs(nw - mid) < 1500]
            p = (sum(1 for o in near if o >= k) / len(near)) if len(near) >= 30 else 0.0
            lo, hi = (mid, hi) if p < 0.5 else (lo, mid)
        threshold = (lo + hi) / 2
        if threshold >= ceiling * 0.95:
            break  # fewer than half of players ever own k items — no real T_k
        out.append(round(threshold))
    return out


def _first_purchases(
    purchase_log: list[dict[str, Any]], costs: dict[str, int]
) -> list[tuple[str, float]]:
    """Big items in completion order: [(item_key, minute), ...], first buy only."""
    out: list[tuple[str, float]] = []
    seen: set[str] = set()
    for entry in sorted(purchase_log, key=lambda e: e.get("time") or 0):
        key, t = entry.get("key"), entry.get("time")
        if not key or t is None or t < 0 or key in seen:
            continue
        seen.add(key)
        if costs.get(key, 0) >= BIG_ITEM_MIN_COST:
            out.append((key, t / 60.0))
    return out


def build_hero_builds(
    details_dir: Path | str | None = None,
    snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Scan parsed details and return the build/threshold artifact."""
    details_dir = Path(details_dir) if details_dir is not None else config.DETAILS_DIR
    if snapshot is None:
        path = config.SNAPSHOT_OUT_DIR / f"snapshot.{config.DEFAULT_PATCH_ID}.json"
        snapshot = json.loads(path.read_text())
    costs, names = _item_costs(snapshot), _item_names(snapshot)

    hero_counts: dict[int, Counter[str]] = defaultdict(Counter)
    hero_times: dict[int, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    hero_games: Counter[int] = Counter()
    global_counts: Counter[str] = Counter()
    global_times: dict[str, list[float]] = defaultdict(list)
    # (net worth, big items owned) sampled every 2 min across all games — the
    # basis for duration-independent completion thresholds.
    nw_owned: list[tuple[float, int]] = []
    matches = 0

    for path in glob.glob(str(details_dir / "*.json")):
        if "_unparsed" in path:
            continue
        detail = json.loads(Path(path).read_text())
        players = detail.get("players") or []
        if not players:
            continue
        matches += 1
        for player in players:
            log, gold_t = player.get("purchase_log"), player.get("gold_t")
            hero_id = player.get("hero_id")
            if not log or not hero_id:
                continue
            purchases = _first_purchases(log, costs)
            if purchases:
                hero_games[hero_id] += 1
            for key, minute in purchases:
                hero_counts[hero_id][key] += 1
                hero_times[hero_id][key].append(minute)
                global_counts[key] += 1
                global_times[key].append(minute)
            if gold_t:
                times = [m for _, m in purchases]
                for minute in range(6, len(gold_t), 2):
                    owned = sum(1 for t in times if t <= minute)
                    nw_owned.append((float(gold_t[minute]), min(owned, _MAX_THRESHOLD_K)))

    def _entry(key: str, times: list[float]) -> dict[str, Any]:
        return {
            "key": key,
            "display_name": names.get(key, key),
            "cost": costs.get(key, 0),
            "median_minute": round(statistics.median(times), 1),
        }

    def _order(counts: Counter[str], times: dict[str, list[float]]) -> list[dict[str, Any]]:
        top = [k for k, _ in counts.most_common(MAX_BUILD_LENGTH)]
        top.sort(key=lambda k: statistics.median(times[k]))  # completion order
        return [_entry(k, times[k]) for k in top]

    thresholds = _completion_thresholds(nw_owned)
    step = (
        round(statistics.mean(
            [thresholds[i + 1] - thresholds[i] for i in range(len(thresholds) - 1)]
        ))
        if len(thresholds) > 1
        else 3000
    )

    return {
        "source_matches": matches,
        "big_item_min_cost": BIG_ITEM_MIN_COST,
        "networth_thresholds": thresholds,
        "threshold_step": step,
        "generic": _order(global_counts, global_times),
        "heroes": {
            str(hero_id): _order(counts, hero_times[hero_id])
            for hero_id, counts in hero_counts.items()
            if hero_games[hero_id] >= MIN_HERO_SAMPLES
        },
    }


def write_hero_builds(
    details_dir: Path | str | None = None,
    out_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Build the artifact and write it to <features>/hero_builds.json."""
    artifact = build_hero_builds(details_dir)
    out_dir = Path(out_dir) if out_dir is not None else config.FEATURES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "hero_builds.json").write_text(json.dumps(artifact, indent=2))
    return artifact


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract item builds + completion thresholds from parsed matches.",
    )
    parser.parse_args(argv)

    artifact = write_hero_builds()
    print(
        f"builds from {artifact['source_matches']} parsed matches: "
        f"{len(artifact['heroes'])} hero-specific, generic fallback of "
        f"{len(artifact['generic'])} items"
    )
    print(f"net-worth thresholds: {artifact['networth_thresholds']} (+{artifact['threshold_step']} each)")


if __name__ == "__main__":
    main()
