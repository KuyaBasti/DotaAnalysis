"""Backfill full match details for banked high-rank matches.

The lightweight publicMatches records in data/matches/ carry no economy data.
This module walks the banked ranked matches and fetches /matches/{id} for each,
keeping only the ones OpenDota has parsed (they carry ``gold_t`` — per-player
net worth by minute). Those parsed details are the ground truth for calibrating
the engine's economy, and later for item-timing models (``purchase_log``).

Unparsed fetches are remembered in a ledger so re-runs never pay for the same
miss twice. Details land in data/details/ (git-ignored, like all data).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from dm_pipeline import config
from dm_pipeline.features.build_dataset import is_ranked
from dm_pipeline.harvest.opendota import OpenDotaClient

_LEDGER = "_unparsed.json"


def _is_parsed(detail: dict[str, Any]) -> bool:
    players = detail.get("players") or []
    return bool(players and players[0].get("gold_t"))


def backfill_details(
    client: OpenDotaClient,
    matches_dir: Path | str,
    details_dir: Path | str,
    *,
    min_rank: int = 70,
    max_fetches: int | None = None,
) -> dict[str, int]:
    """Fetch details for banked ranked matches at/above ``min_rank``.

    Stores parsed matches to ``details_dir``; records unparsed ids in a ledger
    so they are not refetched. Returns counts.
    """
    matches_dir = Path(matches_dir)
    details_dir = Path(details_dir)
    details_dir.mkdir(parents=True, exist_ok=True)

    ledger_path = details_dir / _LEDGER
    unparsed: set[int] = set()
    if ledger_path.exists():
        unparsed = set(json.loads(ledger_path.read_text()))

    fetched = parsed = 0
    for path in sorted(matches_dir.glob("*.json")):
        if max_fetches is not None and fetched >= max_fetches:
            break
        match = json.loads(path.read_text())
        if not is_ranked(match):
            continue
        if (match.get("avg_rank_tier") or 0) < min_rank:
            continue
        match_id = int(match["match_id"])
        if match_id in unparsed or (details_dir / f"{match_id}.json").exists():
            continue  # already resolved one way or the other

        try:
            detail = client.match(match_id)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                break  # budget exhausted even after backoff — resume later
            raise
        fetched += 1
        if _is_parsed(detail):
            (details_dir / f"{match_id}.json").write_text(
                json.dumps(detail, sort_keys=True)
            )
            parsed += 1
        else:
            unparsed.add(match_id)
            ledger_path.write_text(json.dumps(sorted(unparsed)))

    return {"fetched": fetched, "parsed": parsed, "skipped_unparsed": len(unparsed)}


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Backfill parsed match details for banked high-rank matches.",
    )
    parser.add_argument("--max", type=int, default=None, help="max detail fetches")
    parser.add_argument("--min-rank", type=int, default=70)
    args = parser.parse_args(argv)

    client = OpenDotaClient()
    counts = backfill_details(
        client,
        config.MATCHES_DIR,
        config.DATA_DIR / "details",
        min_rank=args.min_rank,
        max_fetches=args.max,
    )
    print(
        f"fetched {counts['fetched']}, stored {counts['parsed']} parsed, "
        f"{counts['skipped_unparsed']} known-unparsed"
    )


if __name__ == "__main__":
    main()
