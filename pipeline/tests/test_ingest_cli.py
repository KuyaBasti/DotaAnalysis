"""Offline test for the ingestion CLI's run() orchestration.

Patches the network fetches with the checked-in fixtures so the full
fetch -> build -> validate -> write path is exercised without hitting OpenDota.
"""

from __future__ import annotations

import json
from pathlib import Path

from dm_pipeline.ingest import cli
from dm_pipeline.ingest.validate_snapshot import validate_snapshot

FIXTURES = Path(__file__).parent / "fixtures"


def test_run_writes_valid_snapshot(monkeypatch, tmp_path) -> None:
    heroes = json.loads((FIXTURES / "opendota_heroes.sample.json").read_text())
    items = json.loads((FIXTURES / "opendota_items.sample.json").read_text())
    # cli imports the fetchers into its own namespace, so patch them there.
    monkeypatch.setattr(cli, "fetch_heroes", lambda **_: heroes)
    monkeypatch.setattr(cli, "fetch_items", lambda **_: items)

    out = tmp_path / "snapshot.test.json"
    path, snapshot = cli.run("7.39c", out_path=out)

    assert path == out
    assert out.exists()
    # What we wrote to disk must itself be schema-valid.
    validate_snapshot(json.loads(out.read_text()))
    assert snapshot["patch_id"] == "7.39c"
    assert len(snapshot["heroes"]) == 3
    assert len(snapshot["items"]) == 3
