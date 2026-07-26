"""Rank brackets: the bands DraftMaster trains and analyzes per.

OpenDota's ``avg_rank_tier`` is a two-digit medal+star code (tens digit = medal:
1 Herald … 8 Immortal). Eight medals is too fine to train 127-hero models on, so
they're grouped into three bands with enough matches each, chosen to match how
Dota actually plays:

- **low** (Herald–Crusader): coordination is rare; heroes that punish
  positioning individually (Sniper, Broodmother, Pudge) overperform.
- **mid** (Archon–Legend): the transition.
- **high** (Ancient–Immortal): coordinated play; setup initiators (Clockwerk,
  Doom, Enigma) overperform by 10+ points over their low-bracket rates.

This module is the single source of truth for those bands — everything
(features, ratings, models, the sim, the API) refers to these keys.
"""

from __future__ import annotations

from typing import Any

# key -> (label, min_tier inclusive, max_tier exclusive)
BRACKETS: dict[str, tuple[str, int, int]] = {
    "low": ("Herald–Crusader", 10, 40),
    "mid": ("Archon–Legend", 40, 60),
    "high": ("Ancient+", 60, 100),
}
BRACKET_KEYS = tuple(BRACKETS)
ALL_BRACKETS = "all"  # the blended, bracket-agnostic model


def bracket_label(key: str) -> str:
    """Human label for a bracket key ('low' -> 'Herald–Crusader')."""
    if key == ALL_BRACKETS:
        return "All ranks"
    return BRACKETS[key][0]


def bracket_bounds(key: str) -> tuple[int, int]:
    """(min_tier, max_tier) for a bracket key; the full range for 'all'."""
    if key == ALL_BRACKETS:
        return (0, 100)
    label_min_max = BRACKETS.get(key)
    if label_min_max is None:
        raise ValueError(f"unknown bracket: {key!r} (expected one of {BRACKET_KEYS} or 'all')")
    _, lo, hi = label_min_max
    return (lo, hi)


def bracket_for_tier(avg_rank_tier: Any) -> str | None:
    """Which bracket a match's avg_rank_tier falls in; None if unranked/unknown."""
    if avg_rank_tier is None:
        return None
    tier = int(avg_rank_tier)
    for key, (_, lo, hi) in BRACKETS.items():
        if lo <= tier < hi:
            return key
    return None


def normalize(key: str | None) -> str:
    """Coerce a user-supplied bracket to a known key (None/'' -> 'all')."""
    if not key:
        return ALL_BRACKETS
    lowered = key.lower()
    if lowered == ALL_BRACKETS or lowered in BRACKETS:
        return lowered
    raise ValueError(f"unknown bracket: {key!r} (expected one of {BRACKET_KEYS} or 'all')")
