"""Offline tests for the details backfill's age-aware unparsed ledger.

OpenDota parses matches lazily, so "unparsed" is only final for matches that
were already old when asked. These tests pin the retry lifecycle: a young miss
is retried after a delay (and the ledger entry clears if the retry parses),
an old miss is final, and the legacy list-format ledger migrates so young
write-offs are resurrected while the dead backlog stays dead.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from dm_pipeline.harvest.backfill import (
    _PARSE_GRACE_SECONDS,
    _RETRY_DELAY_SECONDS,
    backfill_details,
)

NOW = 1_755_600_000.0  # any fixed reference instant
DAY = 24 * 3600.0

PARSED = {"players": [{"gold_t": [0, 100, 250]}]}
UNPARSED = {"players": [{"account_id": 1}]}


class _StubClient:
    """Serves scripted /matches/{id} responses and counts the calls."""

    def __init__(self, responses: dict[int, dict[str, Any]]) -> None:
        self.responses = responses
        self.calls: list[int] = []

    def match(self, match_id: int) -> dict[str, Any]:
        self.calls.append(match_id)
        return self.responses[match_id]


def _bank(matches_dir: Path, match_id: int, start_time: float | None) -> None:
    record: dict[str, Any] = {
        "match_id": match_id,
        "game_mode": 22,
        "lobby_type": 7,
        "avg_rank_tier": 75,
    }
    if start_time is not None:
        record["start_time"] = start_time
    matches_dir.mkdir(parents=True, exist_ok=True)
    (matches_dir / f"{match_id}.json").write_text(json.dumps(record))


def _run(client: _StubClient, tmp_path: Path, now: float) -> dict[str, int]:
    return backfill_details(
        client, tmp_path / "matches", tmp_path / "details", now=now
    )


def test_young_miss_is_retried_and_ledger_clears_when_it_parses(tmp_path) -> None:
    _bank(tmp_path / "matches", 101, start_time=NOW - 1 * DAY)
    client = _StubClient({101: UNPARSED})

    assert _run(client, tmp_path, NOW)["parsed"] == 0
    assert client.calls == [101]

    # Asked again inside the delay: no fetch, OpenDota's queue gets time.
    _run(client, tmp_path, NOW + _RETRY_DELAY_SECONDS / 2)
    assert client.calls == [101]

    # Past the delay, and now parsed: stored, and the miss record clears.
    client.responses[101] = PARSED
    counts = _run(client, tmp_path, NOW + _RETRY_DELAY_SECONDS + 1)
    assert client.calls == [101, 101]
    assert counts["parsed"] == 1
    assert counts["skipped_unparsed"] == 0
    assert (tmp_path / "details" / "101.json").exists()

    # And a stored match is never asked about again.
    _run(client, tmp_path, NOW + 10 * DAY)
    assert client.calls == [101, 101]


def test_a_match_asked_when_already_old_is_final(tmp_path) -> None:
    _bank(tmp_path / "matches", 202, start_time=NOW - _PARSE_GRACE_SECONDS - DAY)
    client = _StubClient({202: UNPARSED})

    _run(client, tmp_path, NOW)
    # However long we wait, it was old at the attempt: unparsed for good.
    _run(client, tmp_path, NOW + 30 * DAY)
    _run(client, tmp_path, NOW + 365 * DAY)
    assert client.calls == [202]


def test_young_miss_goes_final_once_it_ages_past_the_grace(tmp_path) -> None:
    _bank(tmp_path / "matches", 303, start_time=NOW - 1 * DAY)
    client = _StubClient({303: UNPARSED})

    # Keep missing. Finality is judged by the age at the LAST RECORDED
    # attempt, so exactly one attempt lands past the grace boundary — the one
    # that discovers the match aged out — and none after it.
    t = NOW
    while t - (NOW - 1 * DAY) <= _PARSE_GRACE_SECONDS:
        _run(client, tmp_path, t)
        t += _RETRY_DELAY_SECONDS + 1
    _run(client, tmp_path, t)  # the finalizing attempt, just past the grace
    final_calls = len(client.calls)
    _run(client, tmp_path, t + 30 * DAY)
    _run(client, tmp_path, t + 365 * DAY)
    assert len(client.calls) == final_calls
    # Bounded budget: grace/delay caps the attempts per match.
    assert final_calls <= _PARSE_GRACE_SECONDS / _RETRY_DELAY_SECONDS + 2


def test_legacy_list_ledger_resurrects_young_but_not_old(tmp_path) -> None:
    _bank(tmp_path / "matches", 401, start_time=NOW - 60 * DAY)  # dead backlog
    _bank(tmp_path / "matches", 402, start_time=NOW - 2 * DAY)  # written off young
    details = tmp_path / "details"
    details.mkdir(parents=True)
    (details / "_unparsed.json").write_text(json.dumps([401, 402]))

    client = _StubClient({402: PARSED})
    # The migration run stamps both entries "attempted now" and retries
    # nothing itself — recovery starts one retry-delay later.
    assert _run(client, tmp_path, NOW)["parsed"] == 0
    assert client.calls == []

    # Past the delay: the young write-off is asked again (and parses); the
    # old-backlog entry evaluates as attempted-when-old and never is.
    counts = _run(client, tmp_path, NOW + _RETRY_DELAY_SECONDS + 1)
    assert client.calls == [402]
    assert counts["parsed"] == 1
    ledger = json.loads((details / "_unparsed.json").read_text())
    assert "402" not in ledger and "401" in ledger


def test_missing_start_time_counts_as_old(tmp_path) -> None:
    _bank(tmp_path / "matches", 501, start_time=None)
    client = _StubClient({501: UNPARSED})
    _run(client, tmp_path, NOW)
    _run(client, tmp_path, NOW + 30 * DAY)
    assert client.calls == [501]


def test_first_try_parse_never_touches_the_ledger(tmp_path) -> None:
    _bank(tmp_path / "matches", 601, start_time=NOW - 1 * DAY)
    client = _StubClient({601: PARSED})
    counts = _run(client, tmp_path, NOW)
    assert counts == {"fetched": 1, "parsed": 1, "skipped_unparsed": 0}
    assert not (tmp_path / "details" / "_unparsed.json").exists()


def test_walks_newest_matches_first(tmp_path) -> None:
    # Three banked matches, budget for one fetch: the newest id goes first,
    # so the current patch is served before the backlog.
    for match_id in (700, 900, 800):
        _bank(tmp_path / "matches", match_id, start_time=NOW - 1 * DAY)
    client = _StubClient({900: PARSED})
    counts = backfill_details(
        client, tmp_path / "matches", tmp_path / "details", now=NOW, max_fetches=1
    )
    assert client.calls == [900]
    assert counts == {"fetched": 1, "parsed": 1, "skipped_unparsed": 0}
