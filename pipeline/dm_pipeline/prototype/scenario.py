"""A scenario: which heroes each team fields, for a given patch.

This is what turns the abstract sim into a match between real drafts. Hero data
is read from a built snapshot (see the ingestion CLI) and resolved by key.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from dm_pipeline import config


@dataclass
class Scenario:
    patch_id: str
    radiant: list[str]  # hero keys, e.g. ["juggernaut", ...]
    dire: list[str]


def load_heroes(patch_id: str) -> dict[str, dict[str, Any]]:
    """Load a patch's heroes from its snapshot file, keyed by hero key."""
    path = config.SNAPSHOT_OUT_DIR / f"snapshot.{patch_id}.json"
    snapshot = json.loads(path.read_text())
    return {hero["key"]: hero for hero in snapshot["heroes"]}
