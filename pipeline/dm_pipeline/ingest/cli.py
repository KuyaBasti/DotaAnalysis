"""Command-line entry point: build a validated PatchSnapshot from OpenDota.

This ties the ingest pieces together into the single command the data layer is
"done" when it works:

    python -m dm_pipeline.ingest.cli --patch-id 7.39c

It fetches heroes + items, normalizes them into a snapshot, validates against
the schema, and writes data/snapshots/snapshot.<patch_id>.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from dm_pipeline import config
from dm_pipeline.ingest.build_snapshot import build_snapshot
from dm_pipeline.ingest.fetch_constants import fetch_heroes, fetch_items
from dm_pipeline.ingest.validate_snapshot import validate_snapshot


def run(
    patch_id: str,
    *,
    use_cache: bool = True,
    out_path: Path | None = None,
) -> tuple[Path, dict[str, Any]]:
    """Fetch, build, validate, and write a snapshot.

    Returns the output path and the snapshot dict. Raises
    ``jsonschema.ValidationError`` if the built snapshot is non-conforming
    (so a bad build never reaches disk-as-truth silently).
    """
    raw_heroes = fetch_heroes(use_cache=use_cache)
    raw_items = fetch_items(use_cache=use_cache)

    snapshot = build_snapshot(raw_heroes, patch_id=patch_id, raw_items=raw_items)
    validate_snapshot(snapshot)

    out_path = out_path or config.SNAPSHOT_OUT_DIR / f"snapshot.{patch_id}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, indent=2, sort_keys=True))
    return out_path, snapshot


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Build a Dota 2 patch snapshot from OpenDota constants.",
    )
    parser.add_argument(
        "--patch-id",
        default=config.DEFAULT_PATCH_ID,
        help="Patch label recorded in the snapshot, e.g. 7.39c.",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Force a fresh fetch instead of reusing cached raw dumps.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output path (default: data/snapshots/snapshot.<patch-id>.json).",
    )
    args = parser.parse_args(argv)

    out_path, snapshot = run(
        args.patch_id, use_cache=not args.no_cache, out_path=args.out
    )

    n_heroes = len(snapshot["heroes"])
    n_items = len(snapshot.get("items", []))
    print(
        f"Wrote {out_path} — patch {snapshot['patch_id']}: "
        f"{n_heroes} heroes, {n_items} items"
    )


if __name__ == "__main__":
    main()
