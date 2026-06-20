"""Round-trip tests for the patch-ingestion vertical.

Drives offline fixtures through build_snapshot -> validate_snapshot and asserts
the Stage-2 exit criterion in miniature: heroes and items come out correct and
schema-valid. No network access -- uses checked-in samples.
"""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from dm_pipeline.ingest.build_snapshot import build_snapshot
from dm_pipeline.ingest.validate_snapshot import validate_snapshot

FIXTURES = Path(__file__).parent / "fixtures"


def _load_raw() -> dict:
    return json.loads((FIXTURES / "opendota_heroes.sample.json").read_text())


def _load_raw_items() -> dict:
    return json.loads((FIXTURES / "opendota_items.sample.json").read_text())


def test_built_snapshot_is_schema_valid() -> None:
    snapshot = build_snapshot(_load_raw(), patch_id="7.39c")
    validate_snapshot(snapshot)  # raises ValidationError on failure

    assert snapshot["patch_id"] == "7.39c"
    assert snapshot["source"] == "opendota-constants"
    assert len(snapshot["heroes"]) == 3


def test_juggernaut_maps_correctly() -> None:
    snapshot = build_snapshot(_load_raw(), patch_id="7.39c")
    jugg = next(h for h in snapshot["heroes"] if h["key"] == "juggernaut")

    assert jugg["id"] == 8
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


def test_snapshot_includes_items_when_provided() -> None:
    snapshot = build_snapshot(
        _load_raw(), patch_id="7.39c", raw_items=_load_raw_items()
    )
    validate_snapshot(snapshot)

    keys = [it["key"] for it in snapshot["items"]]
    # ward_dispenser has a null dname and must be filtered out.
    assert "ward_dispenser" not in keys
    assert keys == sorted(keys)
    assert len(keys) == 3


def test_items_omitted_when_not_provided() -> None:
    snapshot = build_snapshot(_load_raw(), patch_id="7.39c")
    assert "items" not in snapshot


def test_black_king_bar_maps_correctly() -> None:
    snapshot = build_snapshot(
        _load_raw(), patch_id="7.39c", raw_items=_load_raw_items()
    )
    bkb = next(it for it in snapshot["items"] if it["key"] == "black_king_bar")

    assert bkb["display_name"] == "Black King Bar"
    assert bkb["cost"] == 4050
    assert bkb["cooldown"] == 75
    assert bkb["mana_cost"] == 0
    assert bkb["components"] == ["mithril_hammer", "ogre_axe", "bkb"]


def test_false_cooldown_and_mana_become_none() -> None:
    snapshot = build_snapshot(
        _load_raw(), patch_id="7.39c", raw_items=_load_raw_items()
    )
    treads = next(it for it in snapshot["items"] if it["key"] == "power_treads")

    # OpenDota encodes "no active" as cd=false / mc=false.
    assert treads["cooldown"] is None
    assert treads["mana_cost"] is None
    assert treads["components"] == ["boots", "gloves", "belt_of_strength"]
