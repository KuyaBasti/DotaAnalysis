"""Round-trip test for the patch-ingestion vertical.

Drives the offline fixture through build_snapshot -> validate_snapshot and
asserts the Stage-2 exit criterion in miniature: a hero (Juggernaut) comes out
correct and schema-valid. No network access -- uses a checked-in sample.
"""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from dm_pipeline.ingest.build_snapshot import build_snapshot
from dm_pipeline.ingest.validate_snapshot import validate_snapshot

FIXTURE = Path(__file__).parent / "fixtures" / "opendota_heroes.sample.json"


def _load_raw() -> dict:
    return json.loads(FIXTURE.read_text())


def test_built_snapshot_is_schema_valid() -> None:
    snapshot = build_snapshot(_load_raw(), patch_id="7.39c")
    validate_snapshot(snapshot)  # raises ValidationError on failure

    assert snapshot["patch_id"] == "7.39c"
    assert snapshot["source"] == "opendota-constants"
    assert len(snapshot["heroes"]) == 3


def test_juggernaut_maps_correctly() -> None:
    snapshot = build_snapshot(_load_raw(), patch_id="7.39c")
    jugg = next(h for h in snapshot["heroes"] if h["key"] == "juggernaut")

    assert jugg["display_name"] == "Juggernaut"
    assert jugg["primary_attr"] == "agi"
    assert jugg["attack_type"] == "melee"  # normalized from "Melee"
    assert jugg["roles"] == ["carry", "pusher", "escape"]  # normalized to lowercase
    assert jugg["base_stats"]["agi"] == 34
    assert jugg["stat_gain"]["str"] == 2.2
    assert jugg["attack"] == {"min": 24, "max": 30}


def test_heroes_are_sorted_by_key() -> None:
    snapshot = build_snapshot(_load_raw(), patch_id="7.39c")
    keys = [h["key"] for h in snapshot["heroes"]]
    assert keys == sorted(keys)


def test_invalid_snapshot_is_rejected() -> None:
    snapshot = build_snapshot(_load_raw(), patch_id="7.39c")
    # Corrupt a required field: primary_attr must be one of str/agi/int/all.
    snapshot["heroes"][0]["primary_attr"] = "wisdom"

    with pytest.raises(jsonschema.ValidationError):
        validate_snapshot(snapshot)
