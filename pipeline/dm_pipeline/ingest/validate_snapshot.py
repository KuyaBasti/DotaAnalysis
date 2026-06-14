"""Validate a built snapshot against schemas/snapshot.schema.json.

This is the inspection gate: a snapshot that doesn't conform never makes it to
storage or the engine. ``jsonschema`` raises ``ValidationError`` on the first
violation with a path to the offending field.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

import jsonschema

from dm_pipeline import config


@lru_cache(maxsize=1)
def _load_schema() -> dict[str, Any]:
    return json.loads(config.SNAPSHOT_SCHEMA_PATH.read_text())


def validate_snapshot(snapshot: dict[str, Any]) -> None:
    """Raise ``jsonschema.ValidationError`` if ``snapshot`` is non-conforming."""
    jsonschema.validate(instance=snapshot, schema=_load_schema())
