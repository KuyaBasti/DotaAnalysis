"""A small, rate-limited OpenDota API client.

The free tier allows ~60 calls/minute; the client self-throttles to a minimum
interval between requests so a long-running harvester never trips the limit. The
underlying httpx client is injectable so tests can supply a mock transport.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from dm_pipeline import config

# ~60 calls/min => one call per second; a little headroom keeps us safely under.
_DEFAULT_MIN_INTERVAL = 1.1


class OpenDotaClient:
    def __init__(
        self,
        *,
        base_url: str = config.OPENDOTA_API_URL,
        min_interval: float = _DEFAULT_MIN_INTERVAL,
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._min_interval = min_interval
        self._http = client or httpx.Client(timeout=30.0)
        self._last_call = 0.0

    def _throttle(self) -> None:
        wait = self._min_interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        self._throttle()
        response = self._http.get(f"{self._base_url}{path}", params=params)
        response.raise_for_status()
        return response.json()

    def public_matches(
        self, *, less_than_match_id: int | None = None
    ) -> list[dict[str, Any]]:
        """A page (~100) of recent public matches, newest first.

        Pass the smallest match_id seen so far as ``less_than_match_id`` to page
        backwards through history.
        """
        params: dict[str, Any] = {}
        if less_than_match_id is not None:
            params["less_than_match_id"] = less_than_match_id
        return self.get_json("/publicMatches", params)

    def match(self, match_id: int) -> dict[str, Any]:
        """Full detail for one match (parsed fields present if it was parsed)."""
        return self.get_json(f"/matches/{match_id}")
