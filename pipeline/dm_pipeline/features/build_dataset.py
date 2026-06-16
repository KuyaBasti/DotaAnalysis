"""Build a query-ready dataset from banked public matches.

Turns the raw OpenDota /publicMatches JSONs in data/matches/ into two tidy
Parquet tables -- one row per match, one row per hero per match (normalized) --
that DuckDB queries in milliseconds. This is the foundation for calibration
(hero win rates) and the first ML feature set: draft -> win.
"""

from __future__ import annotations

import glob
import json
from pathlib import Path
from typing import Any

import polars as pl

from dm_pipeline import config


def _hero_ids(team: Any) -> list[int]:
    """Normalize a publicMatches team field (list or comma string) to hero ids."""
    if isinstance(team, str):
        return [int(h) for h in team.split(",") if h]
    return [int(h) for h in (team or []) if h]


def extract_rows(
    matches_dir: Path | str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Read match JSONs into (match rows, hero rows).

    Drops low-quality records: unfinished games (duration <= 0) and matches
    missing a full 5v5 of hero ids.
    """
    match_rows: list[dict[str, Any]] = []
    hero_rows: list[dict[str, Any]] = []

    for path in sorted(glob.glob(str(Path(matches_dir) / "*.json"))):
        match = json.loads(Path(path).read_text())
        radiant = _hero_ids(match.get("radiant_team"))
        dire = _hero_ids(match.get("dire_team"))
        if match.get("duration", 0) <= 0 or len(radiant) != 5 or len(dire) != 5:
            continue

        match_id = int(match["match_id"])
        match_rows.append(
            {
                "match_id": match_id,
                "start_time": int(match.get("start_time", 0)),
                "duration": int(match["duration"]),
                "game_mode": int(match.get("game_mode", 0)),
                "lobby_type": int(match.get("lobby_type", 0)),
                "avg_rank_tier": match.get("avg_rank_tier"),
                "radiant_win": bool(match["radiant_win"]),
            }
        )
        for hero_id in radiant:
            hero_rows.append(
                {"match_id": match_id, "team": "radiant", "hero_id": hero_id}
            )
        for hero_id in dire:
            hero_rows.append({"match_id": match_id, "team": "dire", "hero_id": hero_id})

    return match_rows, hero_rows


def build_dataset(
    matches_dir: Path | str | None = None,
    out_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Extract and write matches.parquet + match_heroes.parquet; return a summary."""
    matches_dir = Path(matches_dir) if matches_dir is not None else config.MATCHES_DIR
    out_dir = Path(out_dir) if out_dir is not None else config.FEATURES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    match_rows, hero_rows = extract_rows(matches_dir)
    matches_path = out_dir / "matches.parquet"
    heroes_path = out_dir / "match_heroes.parquet"
    pl.DataFrame(match_rows).write_parquet(matches_path)
    pl.DataFrame(hero_rows).write_parquet(heroes_path)

    return {
        "matches": len(match_rows),
        "hero_rows": len(hero_rows),
        "matches_path": str(matches_path),
        "heroes_path": str(heroes_path),
    }


def hero_win_rates(
    features_dir: Path | str | None = None, *, min_games: int = 20
) -> pl.DataFrame:
    """Per-hero win rate over the dataset (a calibration staple), via DuckDB."""
    import duckdb

    features_dir = (
        Path(features_dir) if features_dir is not None else config.FEATURES_DIR
    )
    matches = features_dir / "matches.parquet"
    heroes = features_dir / "match_heroes.parquet"
    relation = duckdb.sql(
        f"""
        SELECT
            h.hero_id,
            COUNT(*) AS games,
            ROUND(AVG(CASE WHEN (h.team = 'radiant') = m.radiant_win
                           THEN 1.0 ELSE 0.0 END), 4) AS win_rate
        FROM read_parquet('{heroes}') AS h
        JOIN read_parquet('{matches}') AS m USING (match_id)
        GROUP BY h.hero_id
        HAVING COUNT(*) >= {min_games}
        ORDER BY win_rate DESC
        """
    )
    # Build the polars frame from rows directly so DuckDB's Arrow path (pyarrow)
    # isn't required.
    return pl.DataFrame(relation.fetchall(), schema=relation.columns, orient="row")


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Build the match features dataset from banked matches.",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=0,
        help="also print the top-N heroes by win rate",
    )
    args = parser.parse_args(argv)

    summary = build_dataset()
    print(
        f"wrote {summary['matches']} matches + {summary['hero_rows']} hero rows "
        f"to {config.FEATURES_DIR}"
    )
    if args.top:
        print(hero_win_rates().head(args.top))


if __name__ == "__main__":
    main()
