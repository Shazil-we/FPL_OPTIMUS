"""One-time downloader for Vaastav Anand's historical FPL dataset.

Fetches per-season gameweek, player, team and fixture CSVs into
``data/raw/<season>/`` so that ``src/experiments.py`` can run fully offline.

Usage:
    python scripts/download_data.py [--seasons 2022-23 2023-24 2024-25 2025-26] [--force]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import httpx

BASE_URL: str = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
DEFAULT_SEASONS: tuple[str, ...] = ("2022-23", "2023-24", "2024-25", "2025-26")
FILES: tuple[str, ...] = (
    "gws/merged_gw.csv",
    "players_raw.csv",
    "teams.csv",
    "fixtures.csv",
)
RAW_DIR: Path = Path(__file__).resolve().parents[1] / "data" / "raw"


def download_file(client: httpx.Client, url: str, dest: Path, force: bool) -> bool:
    """Download ``url`` to ``dest``. Returns True if the file exists afterwards."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        print(f"  [skip] {dest.relative_to(RAW_DIR.parent.parent)} (exists)")
        return True
    try:
        resp = client.get(url)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"  [fail] {url}: {exc}")
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(resp.content)
    print(f"  [ok]   {dest.relative_to(RAW_DIR.parent.parent)} ({len(resp.content) / 1e6:.1f} MB)")
    return True


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", nargs="+", default=list(DEFAULT_SEASONS))
    parser.add_argument("--force", action="store_true", help="Re-download existing files")
    args = parser.parse_args(argv)

    failures = 0
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        for season in args.seasons:
            print(f"Season {season}")
            for rel in FILES:
                dest = RAW_DIR / season / Path(rel).name
                ok = download_file(client, f"{BASE_URL}/{season}/{rel}", dest, args.force)
                failures += 0 if ok else 1
    if failures:
        print(f"{failures} file(s) failed to download.")
        return 1
    print("All files downloaded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
