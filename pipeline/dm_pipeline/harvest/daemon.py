"""The match collector.

Pages through recent public matches and banks each as raw JSON on disk. It is
resumable (already-stored matches are skipped) so it can be run repeatedly, and
bounded by ``max_matches`` so a single run stays within the daily rate budget.
A true never-sleeping daemon loop is a later refinement; this is the core a cron
job or a `while true` wrapper can drive.
"""

from __future__ import annotations

import json
from pathlib import Path

from dm_pipeline import config
from dm_pipeline.features.build_dataset import is_ranked
from dm_pipeline.harvest.opendota import OpenDotaClient


# All ranks are banked (product decision: players will pick their own bracket
# to learn at). Pass --min-rank (OpenDota tier, e.g. 70 = Divine) to focus a
# harvest; OpenDota filters server-side either way.
DEFAULT_MIN_RANK = 0


def harvest_public_matches(
    client: OpenDotaClient,
    store_dir: Path | str,
    *,
    max_matches: int = 100,
    fetch_details: bool = False,
    min_rank: int | None = None,
) -> int:
    """Bank up to ``max_matches`` new ranked matches. Returns how many were stored.

    Ranked All Draft only (see ``features.build_dataset.is_ranked``), across
    all ranks by default (``min_rank`` is an OpenDota rank tier, applied
    server-side, to focus a harvest on one bracket and up).

    With ``fetch_details``, each match is enriched via /matches/{id} (more API
    calls, parsed fields when available); otherwise the lightweight publicMatches
    record is stored as-is.
    """
    store_dir = Path(store_dir)
    store_dir.mkdir(parents=True, exist_ok=True)

    stored = 0
    cursor: int | None = None
    empty_pages = 0  # consecutive pages that stored nothing new
    while stored < max_matches:
        batch = client.public_matches(less_than_match_id=cursor, min_rank=min_rank)
        if not batch:
            break  # no more history available
        stored_before = stored
        for match in batch:
            match_id = match["match_id"]
            cursor = match_id  # page backwards from the oldest id seen
            if not is_ranked(match):
                continue  # skip before storing (and before any detail fetch)
            path = store_dir / f"{match_id}.json"
            if path.exists():
                continue  # resumable: don't re-fetch what we already have
            record = client.match(match_id) if fetch_details else match
            path.write_text(json.dumps(record, indent=2, sort_keys=True))
            stored += 1
            if stored >= max_matches:
                break
        # Once we're paging through history we've already banked, stop rather
        # than burn the day's API budget walking ever deeper into the past.
        empty_pages = empty_pages + 1 if stored == stored_before else 0
        if empty_pages >= 10:
            break
    return stored


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Harvest recent public matches from OpenDota into data/matches.",
    )
    parser.add_argument(
        "--max", type=int, default=100, help="max new matches to store this run"
    )
    parser.add_argument(
        "--details",
        action="store_true",
        help="also fetch full match detail per match (uses more rate budget)",
    )
    parser.add_argument(
        "--min-rank",
        type=int,
        default=DEFAULT_MIN_RANK,
        help="minimum OpenDota rank tier (e.g. 70 = Divine); 0 = all ranks (default)",
    )
    args = parser.parse_args(argv)

    client = OpenDotaClient()
    stored = harvest_public_matches(
        client,
        config.MATCHES_DIR,
        max_matches=args.max,
        fetch_details=args.details,
        min_rank=args.min_rank or None,
    )
    print(f"stored {stored} new matches to {config.MATCHES_DIR}")


if __name__ == "__main__":
    main()
