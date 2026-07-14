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


def _ranked(match_id: int, **extra: Any) -> dict[str, Any]:
    """A minimal ranked publicMatches record (the only kind the collector keeps)."""
    return {"match_id": match_id, "game_mode": 22, "lobby_type": 7, **extra}


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
        self,
        *,
        less_than_match_id: int | None = None,
        min_rank: int | None = None,
    ) -> list[dict[str, Any]]:
        if self._served:
            return []
        self._served = True
        return self._page

    def match(self, match_id: int) -> dict[str, Any]:
        return {"match_id": match_id, "detail": True}


def test_harvest_stores_each_match(tmp_path) -> None:
    client = _StubClient([_ranked(10), _ranked(11)])
    stored = harvest_public_matches(client, tmp_path, max_matches=2)

    assert stored == 2
    assert (tmp_path / "10.json").exists()
    assert json.loads((tmp_path / "11.json").read_text())["match_id"] == 11


def test_harvest_respects_max_matches(tmp_path) -> None:
    client = _StubClient([_ranked(i) for i in range(100)])
    stored = harvest_public_matches(client, tmp_path, max_matches=3)
    assert stored == 3
    assert len(list(tmp_path.glob("*.json"))) == 3


def test_harvest_skips_already_stored(tmp_path) -> None:
    (tmp_path / "10.json").write_text("{}")
    client = _StubClient([_ranked(10), _ranked(11)])
    stored = harvest_public_matches(client, tmp_path, max_matches=5)
    assert stored == 1  # 10 already present, only 11 is new


def test_harvest_fetches_details_when_requested(tmp_path) -> None:
    client = _StubClient([_ranked(10)])
    harvest_public_matches(client, tmp_path, max_matches=1, fetch_details=True)
    assert json.loads((tmp_path / "10.json").read_text())["detail"] is True


def test_harvest_skips_non_ranked(tmp_path) -> None:
    turbo = {"match_id": 20, "game_mode": 23, "lobby_type": 0}
    unranked_ad = {"match_id": 21, "game_mode": 22, "lobby_type": 0}
    client = _StubClient([turbo, unranked_ad, _ranked(22)])

    stored = harvest_public_matches(client, tmp_path, max_matches=5)

    assert stored == 1  # only the ranked match is banked
    assert not (tmp_path / "20.json").exists()
    assert not (tmp_path / "21.json").exists()
    assert (tmp_path / "22.json").exists()


def test_harvest_passes_min_rank_to_the_client(tmp_path) -> None:
    seen: dict[str, Any] = {}

    class _RankStub(_StubClient):
        def public_matches(self, *, less_than_match_id=None, min_rank=None):
            seen["min_rank"] = min_rank
            return super().public_matches(less_than_match_id=less_than_match_id)

    client = _RankStub([_ranked(30)])
    harvest_public_matches(client, tmp_path, max_matches=1, min_rank=70)
    assert seen["min_rank"] == 70


def test_client_backs_off_on_429(monkeypatch) -> None:
    import time as time_mod

    calls = {"n": 0}
    naps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429)
        return httpx.Response(200, json=[{"match_id": 1}])

    monkeypatch.setattr(time_mod, "sleep", lambda s: naps.append(s))
    client = OpenDotaClient(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        min_interval=0,
    )
    assert client.public_matches() == [{"match_id": 1}]
    assert calls["n"] == 2  # retried once
    assert 30.0 in naps  # backed off before the retry


def test_harvest_stops_after_pages_with_nothing_new(tmp_path) -> None:
    class _EndlessStub:
        def __init__(self) -> None:
            self.pages = 0

        def public_matches(self, *, less_than_match_id=None, min_rank=None):
            self.pages += 1
            return [_ranked(500)]  # the same already-banked match forever

    (tmp_path / "500.json").write_text("{}")
    client = _EndlessStub()
    stored = harvest_public_matches(client, tmp_path, max_matches=100)
    assert stored == 0
    assert client.pages <= 11  # gave up instead of paging forever
