"""Backfill full match details for banked high-rank matches.

The lightweight publicMatches records in data/matches/ carry no economy data.
This module walks the banked ranked matches and fetches /matches/{id} for each,
keeping only the ones OpenDota has parsed (they carry ``gold_t`` — per-player
net worth by minute). Those parsed details are the ground truth for calibrating
the engine's economy, and later for item-timing models (``purchase_log``).

Unparsed fetches are remembered in a ledger so re-runs don't pay for the same
miss twice — but "unparsed" is only final for OLD matches. OpenDota parses
lazily, often days after a match is played, so a fresh match that answers
"not parsed" today may well be parsed next week. The ledger therefore records
WHEN each miss happened: a match tried while young is retried after a delay
until it either parses or ages past the grace window; a match tried when
already old is final. Without this, the first days of a new patch get
permanently written off — measured on 7.41e day 5: one parsed detail on the
new patch out of 4,633, while the ledger swallowed ~390 fresh matches a day.

Details land in data/details/ (git-ignored, like all data).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx

from dm_pipeline import config
from dm_pipeline.features.build_dataset import is_ranked
from dm_pipeline.harvest.opendota import OpenDotaClient

_LEDGER = "_unparsed.json"
# A match still unparsed this long after it was PLAYED never will be — the
# public parse queue clears in days, not weeks.
_PARSE_GRACE_SECONDS = 14 * 24 * 3600
# How long to wait before asking OpenDota about the same young match again.
# The cron runs four times a day; retrying every run would burn the fetch
# budget on the same misses instead of new matches.
_RETRY_DELAY_SECONDS = 2 * 24 * 3600


def _load_ledger(path: Path, now: float) -> dict[int, float]:
    """The unparsed ledger: match id -> unix time of the last attempt.

    Migrates the legacy format (a bare list of ids) by stamping every entry
    with ``now``. That is exactly the right resurrection: legacy entries from
    the old backlog evaluate as attempted-when-old (final, as they always
    were), while recent matches wrongly written off before the ledger knew
    about age become attempted-when-young — eligible for retry.
    """
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    if isinstance(raw, list):
        migrated = {int(match_id): now for match_id in raw}
        # Persist immediately: if the migration only lived in memory, a run
        # that fetches nothing would leave the legacy list on disk, and every
        # later run would re-stamp it "now" — young entries would sit on a
        # cooldown that never expires.
        path.write_text(json.dumps(migrated, sort_keys=True))
        return migrated
    return {int(match_id): float(ts) for match_id, ts in raw.items()}


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
    now: float | None = None,
) -> dict[str, int]:
    """Fetch details for banked ranked matches at/above ``min_rank``.

    Stores parsed matches to ``details_dir``; records unparsed misses in an
    age-aware ledger — final for matches that were already old when asked,
    retried after a delay for matches asked too young. Returns counts.
    """
    matches_dir = Path(matches_dir)
    details_dir = Path(details_dir)
    details_dir.mkdir(parents=True, exist_ok=True)
    if now is None:
        now = time.time()

    ledger_path = details_dir / _LEDGER
    unparsed = _load_ledger(ledger_path, now)

    fetched = parsed = 0
    # Newest first: everything downstream of data/details/ measures the
    # CURRENT meta, and oldest-first left a 32k-match pre-patch backlog queued
    # ahead of the first 7.41e game — weeks of budget spent growing a corpus
    # the consumers already have enough of. Newest-first is only safe with the
    # age-aware ledger above; without it, every too-fresh match would be
    # written off for good on first touch. Sorted numerically: match ids are
    # all 10 digits today, but lexicographic order would silently break the
    # day they reach 11.
    def _match_id_of(p: Path) -> int:
        try:
            return int(p.stem)
        except ValueError:
            return 0  # non-id files sort last under reverse order

    for path in sorted(matches_dir.glob("*.json"), key=_match_id_of, reverse=True):
        if max_fetches is not None and fetched >= max_fetches:
            break
        match = json.loads(path.read_text())
        if not is_ranked(match):
            continue
        if (match.get("avg_rank_tier") or 0) < min_rank:
            continue
        match_id = int(match["match_id"])
        if (details_dir / f"{match_id}.json").exists():
            continue  # already stored
        attempted_at = unparsed.get(match_id)
        if attempted_at is not None:
            # A missing start_time counts as old: final, never retried.
            start_time = float(match.get("start_time") or 0.0)
            if attempted_at - start_time > _PARSE_GRACE_SECONDS:
                continue  # was already old when asked — unparsed for good
            if now - attempted_at < _RETRY_DELAY_SECONDS:
                continue  # asked recently — give OpenDota's queue more time

        try:
            detail = client.match(match_id)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                break  # budget exhausted even after backoff — resume later
            if e.response.status_code >= 500:
                continue  # OpenDota hiccup on one match: skip it, keep going
            raise
        except httpx.TransportError:
            continue  # transient network hiccup: skip this match, keep going
        fetched += 1
        if _is_parsed(detail):
            (details_dir / f"{match_id}.json").write_text(
                json.dumps(detail, sort_keys=True)
            )
            parsed += 1
            # A retry that finally parsed: the miss record is obsolete.
            if unparsed.pop(match_id, None) is not None:
                ledger_path.write_text(json.dumps(unparsed, sort_keys=True))
        else:
            unparsed[match_id] = now
            ledger_path.write_text(json.dumps(unparsed, sort_keys=True))

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
