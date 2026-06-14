"""Central configuration for the dm_pipeline package.

Paths and constants live here so nothing downstream hardcodes them. In
particular, the patch id is always passed explicitly as a parameter to ingest
functions; ``DEFAULT_PATCH_ID`` is only a convenience default for CLI/dev use,
never a value baked into logic elsewhere.
"""

from __future__ import annotations

from pathlib import Path

# --- Repo layout ------------------------------------------------------------
# config.py lives at <repo>/pipeline/dm_pipeline/config.py, so the repo root is
# three parents up.
REPO_ROOT: Path = Path(__file__).resolve().parents[2]

SCHEMA_DIR: Path = REPO_ROOT / "schemas"
SNAPSHOT_SCHEMA_PATH: Path = SCHEMA_DIR / "snapshot.schema.json"

# data/ is git-ignored: raw API dumps and built snapshots are derived artifacts.
DATA_DIR: Path = REPO_ROOT / "data"
RAW_DIR: Path = DATA_DIR / "raw"
SNAPSHOT_OUT_DIR: Path = DATA_DIR / "snapshots"

# --- External data sources --------------------------------------------------
# OpenDota exposes pre-parsed, JSON-friendly game constants for the current
# patch. See https://docs.opendota.com/ (constants endpoints).
OPENDOTA_CONSTANTS_URL: str = "https://api.opendota.com/api/constants"

# --- Defaults ---------------------------------------------------------------
DEFAULT_PATCH_ID: str = "7.39c"
