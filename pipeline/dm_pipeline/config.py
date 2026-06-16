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

# data/ is git-ignored: raw API dumps, built snapshots, and harvested matches
# are all derived artifacts.
DATA_DIR: Path = REPO_ROOT / "data"
RAW_DIR: Path = DATA_DIR / "raw"
SNAPSHOT_OUT_DIR: Path = DATA_DIR / "snapshots"
MATCHES_DIR: Path = DATA_DIR / "matches"
SIM_OUT_DIR: Path = DATA_DIR / "sims"
FEATURES_DIR: Path = DATA_DIR / "features"

# --- External data sources --------------------------------------------------
OPENDOTA_API_URL: str = "https://api.opendota.com/api"
# Constants (game data) live under the same API. Free tier (verified): 60
# calls/minute, ~2000 calls/day -- enough to bank thousands of matches/day.
OPENDOTA_CONSTANTS_URL: str = f"{OPENDOTA_API_URL}/constants"

# --- Defaults ---------------------------------------------------------------
DEFAULT_PATCH_ID: str = "7.39c"
