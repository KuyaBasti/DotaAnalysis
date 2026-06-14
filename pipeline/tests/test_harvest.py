"""Offline tests for the OpenDota harvester.

The client is tested against an httpx MockTransport (no network); the collector
is tested against a stub client so storage/resumability logic is exercised
without API calls.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from dm_pipeline.harvest.daemon import harvest_public_matches
from dm_pipeline.harvest.opendota import OpenDotaClient


def test_client_parses_public_matches() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/publicMatches")
        return httpx.Response(200, json=[{"match_id": 1}, {"match_id": 2}])

    client = OpenDotaClient(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        min_interval=0,
    )
    assert client.public_matches() == [{"match_id": 1}, {"match_id": 2}]


class _StubClient:
    """Serves one page of matches, then nothing (so the loop terminates)."""

    def __init__(self, page: list[dict[str, Any]]) -> None:
        self._page = page
        self._served = False

    def public_matches(
        self, *, less_than_match_id: int | None = None
    ) -> list[dict[str, Any]]:
        if self._served:
            return []
        self._served = True
        return self._page

    def match(self, match_id: int) -> dict[str, Any]:
        return {"match_id": match_id, "detail": True}


def test_harvest_stores_each_match(tmp_path) -> None:
    client = _StubClient([{"match_id": 10}, {"match_id": 11}])
    stored = harvest_public_matches(client, tmp_path, max_matches=2)

    assert stored == 2
    assert (tmp_path / "10.json").exists()
    assert json.loads((tmp_path / "11.json").read_text())["match_id"] == 11


def test_harvest_respects_max_matches(tmp_path) -> None:
    client = _StubClient([{"match_id": i} for i in range(100)])
    stored = harvest_public_matches(client, tmp_path, max_matches=3)
    assert stored == 3
    assert len(list(tmp_path.glob("*.json"))) == 3


def test_harvest_skips_already_stored(tmp_path) -> None:
    (tmp_path / "10.json").write_text("{}")
    client = _StubClient([{"match_id": 10}, {"match_id": 11}])
    stored = harvest_public_matches(client, tmp_path, max_matches=5)
    assert stored == 1  # 10 already present, only 11 is new


def test_harvest_fetches_details_when_requested(tmp_path) -> None:
    client = _StubClient([{"match_id": 10}])
    harvest_public_matches(client, tmp_path, max_matches=1, fetch_details=True)
    assert json.loads((tmp_path / "10.json").read_text())["detail"] is True
