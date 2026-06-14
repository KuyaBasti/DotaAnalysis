"""Fetch raw game constants from OpenDota.

This module only *retrieves and caches* upstream JSON; it does no normalization
(that is ``build_snapshot``'s job). The raw dump is cached to ``data/raw`` so
repeat runs and downstream debugging don't hammer the API, and so we keep a
local copy of exactly what we ingested.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from dm_pipeline import config


def fetch_heroes(*, use_cache: bool = True, timeout: float = 30.0) -> dict[str, Any]:
    """Return OpenDota's ``constants/heroes`` payload (id-keyed dict).

    Args:
        use_cache: If True, return a previously cached dump when present
            instead of hitting the network.
        timeout: Per-request timeout in seconds.
    """
    cache_path = config.RAW_DIR / "opendota_heroes.json"

    if use_cache and cache_path.exists():
        return json.loads(cache_path.read_text())

    url = f"{config.OPENDOTA_CONSTANTS_URL}/heroes"
    response = httpx.get(url, timeout=timeout)
    response.raise_for_status()
    data: dict[str, Any] = response.json()

    _write_cache(cache_path, data)
    return data


def fetch_items(*, use_cache: bool = True, timeout: float = 30.0) -> dict[str, Any]:
    """Return OpenDota's ``constants/items`` payload (name-keyed dict).

    Args mirror :func:`fetch_heroes`.
    """
    cache_path = config.RAW_DIR / "opendota_items.json"

    if use_cache and cache_path.exists():
        return json.loads(cache_path.read_text())

    url = f"{config.OPENDOTA_CONSTANTS_URL}/items"
    response = httpx.get(url, timeout=timeout)
    response.raise_for_status()
    data: dict[str, Any] = response.json()

    _write_cache(cache_path, data)
    return data


def _write_cache(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True))
