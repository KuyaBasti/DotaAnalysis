"""Normalize raw OpenDota constants into our PatchSnapshot shape.

This is the anti-corruption layer: every field name and value here is *ours*,
not OpenDota's. When we later switch the source to Valve VPK files, only this
module changes -- the schema and all downstream consumers stay put.

Output conforms to schemas/snapshot.schema.json (validated separately by
``validate_snapshot``).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# OpenDota's hero key looks like "npc_dota_hero_juggernaut"; we strip the prefix.
_HERO_KEY_PREFIX = "npc_dota_hero_"


def build_snapshot(
    raw_heroes: dict[str, Any],
    *,
    patch_id: str,
    source: str = "opendota-constants",
    raw_items: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble a PatchSnapshot dict from OpenDota constants payloads.

    Args:
        raw_heroes: OpenDota ``constants/heroes`` payload (id -> hero object).
        patch_id: The patch this snapshot represents, e.g. "7.39c".
        source: Provenance tag recorded in the snapshot.
        raw_items: Optional OpenDota ``constants/items`` payload (name -> item
            object). When provided, an ``items`` array is added to the snapshot.
    """
    heroes = [_map_hero(raw) for raw in raw_heroes.values()]
    heroes.sort(key=lambda h: h["key"])

    snapshot: dict[str, Any] = {
        "patch_id": patch_id,
        "source": source,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "heroes": heroes,
    }

    if raw_items is not None:
        # Skip entries without a display name (recipes/placeholders carry none).
        items = [
            _map_item(key, raw)
            for key, raw in raw_items.items()
            if raw.get("dname")
        ]
        items.sort(key=lambda i: i["key"])
        snapshot["items"] = items

    return snapshot


def _map_hero(raw: dict[str, Any]) -> dict[str, Any]:
    """Map one OpenDota hero object to our normalized hero shape."""
    name: str = raw["name"]
    key = name[len(_HERO_KEY_PREFIX):] if name.startswith(_HERO_KEY_PREFIX) else name

    return {
        "id": raw["id"],
        "key": key,
        "display_name": raw["localized_name"],
        "primary_attr": raw["primary_attr"],
        "attack_type": raw["attack_type"].lower(),
        "roles": [role.lower() for role in raw.get("roles", [])],
        "base_stats": {
            "str": raw["base_str"],
            "agi": raw["base_agi"],
            "int": raw["base_int"],
        },
        "stat_gain": {
            "str": raw["str_gain"],
            "agi": raw["agi_gain"],
            "int": raw["int_gain"],
        },
        "attack": {
            "min": raw["base_attack_min"],
            "max": raw["base_attack_max"],
        },
        "move_speed": raw["move_speed"],
    }


def _map_item(key: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Map one OpenDota item object to our normalized item shape."""
    return {
        "key": key,
        "display_name": raw["dname"],
        "cost": raw.get("cost"),
        "cooldown": _num_or_none(raw.get("cd")),
        "mana_cost": _num_or_none(raw.get("mc")),
        "components": raw.get("components"),
    }


def _num_or_none(value: Any) -> float | int | None:
    """OpenDota encodes "no cooldown/mana" as ``false``; normalize that to None."""
    # bool is a subclass of int, so reject it before the numeric check.
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None
