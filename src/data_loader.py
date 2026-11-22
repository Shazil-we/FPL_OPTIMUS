"""Data engine for FPL-Optimus.

This module has two halves that share one feature pipeline:

1. **Offline historical telemetry** (`HistoricalDataLoader`): reads Vaastav Anand's
   per-season CSVs from ``data/raw/<season>/`` and standardises them into a single
   long table with one row per (player, fixture).
2. **Live FPL gateway** (`FPLApiClient`, `LiveDataBuilder`): async ``httpx`` client for
   the official FPL API with an in-memory TTL cache plus a disk snapshot fallback in
   ``data/cache/``. Live gameweek payloads are converted to the *same* standard schema.

Both halves feed `FeatureEngineer`, which computes rolling 3/5-match form, per-90
rates, DefCon (CBIT/CBIRT) telemetry, team context and fixture difficulty. Features
for a fixture are always computed from *strictly earlier* matches (no leakage).

Nothing in the offline half performs network I/O, so ``src/experiments.py`` can run
without connectivity.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

import httpx
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------------------
# Paths & constants
# --------------------------------------------------------------------------------------
PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parents[1]
RAW_DIR: Final[Path] = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR: Final[Path] = PROJECT_ROOT / "data" / "processed"
CACHE_DIR: Final[Path] = PROJECT_ROOT / "data" / "cache"

SEASONS: Final[tuple[str, ...]] = ("2022-23", "2023-24", "2024-25", "2025-26")
DEFCON_FIRST_SEASON: Final[str] = "2025-26"
POSITIONS: Final[tuple[str, ...]] = ("GK", "DEF", "MID", "FWD")
ELEMENT_TYPE_TO_POS: Final[dict[int, str]] = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
#: DefCon action thresholds that award +2 points (GK is not eligible).
DEFCON_THRESHOLD: Final[dict[str, float]] = {"GK": np.inf, "DEF": 10, "MID": 12, "FWD": 12}
DEFCON_POINTS: Final[int] = 2
ROLL_WINDOWS: Final[tuple[int, ...]] = (3, 5)

#: Raw per-match stats carried through the standard schema.
MATCH_STATS: Final[tuple[str, ...]] = (
    "minutes", "total_points", "goals_scored", "assists", "clean_sheets",
    "goals_conceded", "bonus", "bps", "saves", "starts", "xg", "xa", "xgc",
    "cbi", "tackles", "recoveries", "cbit", "cbirt", "defcon", "defcon_hit",
)
#: Stats whose rolling means become model features.
ROLL_STATS: Final[tuple[str, ...]] = (
    "minutes", "total_points", "xg", "xa", "xgc", "bps", "bonus", "starts",
    "clean_sheets", "cbit", "cbirt", "defcon", "defcon_hit",
)
#: Stats expressed as per-90 rates over the longest rolling window.
PER90_STATS: Final[tuple[str, ...]] = ("xg", "xa", "xgc", "cbit", "cbirt")


def season_has_defcon(season: str) -> bool:
    """Return True if DefCon stats/points exist for ``season`` (2025-26 onwards)."""
    return season >= DEFCON_FIRST_SEASON


# --------------------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------------------
def add_defcon_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Derive CBIT, CBIRT, DefCon count/hit/points and the DefCon-free target.

    Expects columns ``position``, ``cbi``, ``tackles``, ``recoveries``,
    ``total_points`` and ``defcon_available`` (bool). For seasons without DefCon data
    the DefCon columns are NaN and ``defcon_points`` is 0.
    """
    out = df.copy()
    avail = out["defcon_available"].astype(bool)
    out["cbit"] = (out["cbi"] + out["tackles"]).where(avail)
    out["cbirt"] = (out["cbit"] + out["recoveries"]).where(avail)
    is_def = out["position"].eq("DEF")
    out["defcon"] = np.where(is_def, out["cbit"], out["cbirt"])
    out.loc[out["position"].eq("GK"), "defcon"] = np.nan
    out.loc[~avail, "defcon"] = np.nan
    threshold = out["position"].map(DEFCON_THRESHOLD).astype(float)
    hit = (out["defcon"] >= threshold).astype(float)
    eligible = avail & out["position"].ne("GK")
    out["defcon_hit"] = hit.where(eligible)
    out["defcon_points"] = np.where(eligible & hit.eq(1.0), DEFCON_POINTS, 0)
    out["target_base"] = out["total_points"] - out["defcon_points"]
    return out


# --------------------------------------------------------------------------------------
# Offline historical loader
# --------------------------------------------------------------------------------------
class HistoricalDataLoader:
    """Loads and standardises Vaastav's historical CSVs (offline, no network)."""

    def __init__(self, raw_dir: Path = RAW_DIR, seasons: tuple[str, ...] = SEASONS) -> None:
        self._raw_dir = raw_dir
        self._seasons = seasons

    @property
    def seasons(self) -> tuple[str, ...]:
        """Seasons handled by this loader."""
        return self._seasons

    def _read(self, season: str, name: str) -> pd.DataFrame:
        path = self._raw_dir / season / name
        if not path.exists():
            raise FileNotFoundError(
                f"{path} missing - run `python scripts/download_data.py` first."
            )
        return pd.read_csv(path, low_memory=False)

    def load_teams(self, season: str) -> pd.DataFrame:
        """Return the season's teams table with strength ratings."""
        teams = self._read(season, "teams.csv")
        teams["season"] = season
        return teams

    def load_season(self, season: str) -> pd.DataFrame:
        """Load one season as a standardised (player, fixture) table."""
        gw = self._read(season, "merged_gw.csv")
        players = self._read(season, "players_raw.csv")
        teams = self.load_teams(season)
        fixtures = self._read(season, "fixtures.csv")

        gw = gw[gw["position"].isin(POSITIONS)].copy()  # drops 2024-25 'AM' rows
        gw = gw.drop_duplicates(subset=["element", "fixture"], keep="last")

        has_defcon = season_has_defcon(season) and "clearances_blocks_interceptions" in gw
        name_to_id = dict(zip(teams["name"], teams["id"]))
        code_map = dict(zip(players["id"], players["code"]))

        df = pd.DataFrame(
            {
                "season": season,
                "gw": gw["GW"].astype(int),
                "element": gw["element"].astype(int),
                "player_key": gw["element"].map(code_map),
                "name": gw["name"].astype(str),
                "position": gw["position"].astype(str),
                "team_id": gw["team"].map(name_to_id),
                "opponent_team_id": gw["opponent_team"].astype(int),
                "was_home": gw["was_home"].astype(str).str.lower().eq("true").astype(int),
                "fixture": gw["fixture"].astype(int),
                "kickoff_time": pd.to_datetime(gw["kickoff_time"], utc=True),
                "value": gw["value"].astype(float) / 10.0,
                "minutes": gw["minutes"],
                "total_points": gw["total_points"],
                "goals_scored": gw["goals_scored"],
                "assists": gw["assists"],
                "clean_sheets": gw["clean_sheets"],
                "goals_conceded": gw["goals_conceded"],
                "bonus": gw["bonus"],
                "bps": gw["bps"],
                "saves": gw["saves"],
                "starts": gw.get("starts", (gw["minutes"] >= 60).astype(int)),
                "xg": gw["expected_goals"],
                "xa": gw["expected_assists"],
                "xgc": gw["expected_goals_conceded"],
                "cbi": gw["clearances_blocks_interceptions"] if has_defcon else np.nan,
                "tackles": gw["tackles"] if has_defcon else np.nan,
                "recoveries": gw["recoveries"] if has_defcon else np.nan,
                "defcon_available": has_defcon,
            }
        )
        # Fall back to a season-scoped key for players missing from players_raw.
        missing = df["player_key"].isna()
        df.loc[missing, "player_key"] = -(df.loc[missing, "element"] + 10_000 * SEASONS.index(season))
        df["player_key"] = df["player_key"].astype(np.int64)

        fdr = fixtures[["id", "team_h_difficulty", "team_a_difficulty"]].rename(columns={"id": "fixture"})
        df = df.merge(fdr, on="fixture", how="left")
        df["fdr"] = np.where(df["was_home"] == 1, df["team_h_difficulty"], df["team_a_difficulty"])
        df = df.drop(columns=["team_h_difficulty", "team_a_difficulty"])
        df = attach_team_strength(df, teams)
        return add_defcon_columns(df)

    def load_all(self) -> pd.DataFrame:
        """Load and concatenate every configured season."""
        frames = [self.load_season(s) for s in self._seasons]
        return pd.concat(frames, ignore_index=True)


def attach_team_strength(df: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    """Join own/opponent attack & defence strength (venue-aware) from a teams table."""
    t = teams.set_index("id")
    home = df["was_home"] == 1
    opp = df["opponent_team_id"]
    own = df["team_id"]
    out = df.copy()
    out["opp_strength_attack"] = np.where(
        home, opp.map(t["strength_attack_away"]), opp.map(t["strength_attack_home"])
    )
    out["opp_strength_defence"] = np.where(
        home, opp.map(t["strength_defence_away"]), opp.map(t["strength_defence_home"])
    )
    out["own_strength_attack"] = np.where(
        home, own.map(t["strength_attack_home"]), own.map(t["strength_attack_away"])
    )
    out["own_strength_defence"] = np.where(
        home, own.map(t["strength_defence_home"]), own.map(t["strength_defence_away"])
    )
    return out


# --------------------------------------------------------------------------------------
# Feature engineering (shared by offline + live)
# --------------------------------------------------------------------------------------
class FeatureEngineer:
    """Builds leakage-free rolling features on a standardised match table.

    The core idea is a *post-match state*: after each match, rolling aggregates of the
    player's last ``w`` matches. Training features for a fixture are the state after
    the player's previous match (``shift(1)``); live features for upcoming fixtures are
    the state after the player's most recent completed match.
    """

    PLAYER_KEY: Final[str] = "player_key"

    def __init__(self, windows: tuple[int, ...] = ROLL_WINDOWS) -> None:
        self._windows = windows

    # ---------------------------- player state ---------------------------------------
    def _player_state(self, df: pd.DataFrame) -> pd.DataFrame:
        """Rolling post-match aggregates per player (index-aligned with ``df``)."""
        df = df.sort_values([self.PLAYER_KEY, "kickoff_time"])
        g = df.groupby(self.PLAYER_KEY, sort=False)
        state = pd.DataFrame(index=df.index)
        stats = list(ROLL_STATS)
        for w in self._windows:
            rolled = g[stats].rolling(w, min_periods=1).mean().reset_index(level=0, drop=True)
            state[[f"{c}_roll{w}" for c in stats]] = rolled[stats].to_numpy()
        w_max = max(self._windows)
        sums = (
            g[["minutes", *PER90_STATS]].rolling(w_max, min_periods=1).sum().reset_index(level=0, drop=True)
        )
        mins = sums["minutes"].replace(0, np.nan)
        for c in PER90_STATS:
            state[f"{c}_per90"] = (sums[c] / mins * 90.0).to_numpy()
        state["matches_played"] = g.cumcount().to_numpy() + 1
        # Season-to-date points per match.
        gs = df.groupby([self.PLAYER_KEY, "season"], sort=False)
        state["ppm_season"] = gs["total_points"].transform(lambda s: s.expanding().mean()).to_numpy()
        return state.reindex(df.index).sort_index()

    # ---------------------------- team state -----------------------------------------
    @staticmethod
    def _team_match_table(df: pd.DataFrame) -> pd.DataFrame:
        """Aggregate per (season, fixture, team): xG for/against and kickoff."""
        team = (
            df.groupby(["season", "fixture", "team_id"], as_index=False)
            .agg(kickoff_time=("kickoff_time", "first"), team_xg=("xg", "sum"),
                 opponent_team_id=("opponent_team_id", "first"))
        )
        opp = team[["season", "fixture", "team_id", "team_xg"]].rename(
            columns={"team_id": "opponent_team_id", "team_xg": "team_xga"}
        )
        return team.merge(opp, on=["season", "fixture", "opponent_team_id"], how="left")

    def _team_state(self, team: pd.DataFrame, w: int = 5) -> pd.DataFrame:
        """Rolling team xG for/against and a possession proxy, per team and season."""
        team = team.sort_values(["season", "team_id", "kickoff_time"]).copy()
        g = team.groupby(["season", "team_id"], sort=False)
        team["team_xg_roll"] = g["team_xg"].transform(lambda s: s.rolling(w, min_periods=1).mean())
        team["team_xga_roll"] = g["team_xga"].transform(lambda s: s.rolling(w, min_periods=1).mean())
        total = (team["team_xg_roll"] + team["team_xga_roll"]).replace(0, np.nan)
        # Possession/territory proxy: share of expected goals in recent matches.
        team["team_xg_share"] = team["team_xg_roll"] / total
        return team

    TEAM_STATE_COLS: Final[tuple[str, ...]] = ("team_xg_roll", "team_xga_roll", "team_xg_share")

    # ---------------------------- public API -----------------------------------------
    def build_training_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Return ``df`` with leakage-free feature columns for every historical fixture."""
        df = df.sort_values([self.PLAYER_KEY, "kickoff_time"]).reset_index(drop=True)
        state = self._player_state(df)
        shifted = state.groupby(df[self.PLAYER_KEY]).shift(1)
        # A player's first match ever has no history; season-to-date is reset per season.
        new_season = df["season"].ne(df.groupby(self.PLAYER_KEY)["season"].shift(1))
        shifted.loc[new_season, "ppm_season"] = np.nan
        shifted["matches_played"] = shifted["matches_played"].fillna(0)
        out = pd.concat([df, shifted], axis=1)

        team = self._team_state(self._team_match_table(df))
        team_cols = list(self.TEAM_STATE_COLS)
        team[team_cols] = team.groupby(["season", "team_id"])[team_cols].shift(1)
        own = team[["season", "fixture", "team_id", *team_cols]]
        out = out.merge(own, on=["season", "fixture", "team_id"], how="left")
        opp = own.rename(columns={"team_id": "opponent_team_id", **{c: f"opp_{c}" for c in team_cols}})
        out = out.merge(opp, on=["season", "fixture", "opponent_team_id"], how="left")
        return out.sort_values(["season", "gw", "kickoff_time", "element"]).reset_index(drop=True)

    def latest_player_state(self, history: pd.DataFrame) -> pd.DataFrame:
        """State after each player's most recent match (for predicting upcoming fixtures)."""
        df = history.sort_values([self.PLAYER_KEY, "kickoff_time"]).reset_index(drop=True)
        state = self._player_state(df)
        last_idx = df.groupby(self.PLAYER_KEY).tail(1).index
        current_season = df["season"].max()
        latest = state.loc[last_idx].copy()
        latest[self.PLAYER_KEY] = df.loc[last_idx, self.PLAYER_KEY].to_numpy()
        stale = df.loc[last_idx, "season"].ne(current_season).to_numpy()
        latest.loc[stale, "ppm_season"] = np.nan
        return latest.reset_index(drop=True)

    def latest_team_state(self, history: pd.DataFrame) -> pd.DataFrame:
        """Most recent rolling team context per team in the latest season."""
        current = history[history["season"] == history["season"].max()]
        team = self._team_state(self._team_match_table(current))
        cols = ["team_id", *self.TEAM_STATE_COLS]
        return team.groupby("team_id").tail(1)[cols].reset_index(drop=True)


#: Model feature columns produced by `FeatureEngineer` (+ fixture context).
def feature_columns() -> list[str]:
    """Ordered list of model input features."""
    cols: list[str] = []
    for w in ROLL_WINDOWS:
        cols += [f"{c}_roll{w}" for c in ROLL_STATS]
    cols += [f"{c}_per90" for c in PER90_STATS]
    cols += ["matches_played", "ppm_season"]
    cols += list(FeatureEngineer.TEAM_STATE_COLS) + [f"opp_{c}" for c in FeatureEngineer.TEAM_STATE_COLS]
    cols += [
        "value", "was_home", "fdr",
        "opp_strength_attack", "opp_strength_defence",
        "own_strength_attack", "own_strength_defence",
        "pos_GK", "pos_DEF", "pos_MID", "pos_FWD",
    ]
    return cols


def add_position_dummies(df: pd.DataFrame) -> pd.DataFrame:
    """One-hot encode ``position`` into ``pos_*`` columns."""
    out = df.copy()
    for p in POSITIONS:
        out[f"pos_{p}"] = out["position"].eq(p).astype(int)
    return out


def build_processed_dataset(
    raw_dir: Path = RAW_DIR, out_dir: Path = PROCESSED_DIR, save: bool = True
) -> pd.DataFrame:
    """Offline pipeline: raw CSVs -> engineered features (optionally saved to CSV)."""
    raw = HistoricalDataLoader(raw_dir).load_all()
    feats = add_position_dummies(FeatureEngineer().build_training_features(raw))
    if save:
        out_dir.mkdir(parents=True, exist_ok=True)
        feats.to_csv(out_dir / "features.csv", index=False)
    return feats


def load_processed(path: Path = PROCESSED_DIR / "features.csv") -> pd.DataFrame:
    """Load the processed feature table, building it from raw data if absent."""
    if not path.exists():
        return build_processed_dataset()
    df = pd.read_csv(path, low_memory=False)
    df["kickoff_time"] = pd.to_datetime(df["kickoff_time"], utc=True)
    return df


# --------------------------------------------------------------------------------------
# Live FPL API client with caching
# --------------------------------------------------------------------------------------
class FPLApiError(RuntimeError):
    """Raised when the FPL API is unreachable and no cached snapshot exists."""


@dataclass
class _CacheEntry:
    payload: Any
    stored_at: float


@dataclass
class CacheStore:
    """Two-level cache: in-memory TTL dictionary backed by JSON snapshots on disk.

    ``ttl=None`` marks an entry as permanent (e.g. finished gameweeks).
    """

    directory: Path = CACHE_DIR
    _memory: dict[str, _CacheEntry] = field(default_factory=dict)

    def _path(self, key: str) -> Path:
        safe = key.strip("/").replace("/", "__") or "root"
        return self.directory / f"{safe}.json"

    def get_fresh(self, key: str, ttl: float | None) -> Any | None:
        """Return a cached payload younger than ``ttl`` seconds (memory, then disk)."""
        if ttl is not None and ttl <= 0:
            return None
        now = time.time()
        entry = self._memory.get(key)
        if entry and (ttl is None or now - entry.stored_at < ttl):
            return entry.payload
        path = self._path(key)
        if path.exists():
            age = now - path.stat().st_mtime
            if ttl is None or age < ttl:
                payload = json.loads(path.read_text(encoding="utf-8"))
                self._memory[key] = _CacheEntry(payload, path.stat().st_mtime)
                return payload
        return None

    def get_stale(self, key: str) -> Any | None:
        """Return any cached payload regardless of age (network-failure fallback)."""
        if key in self._memory:
            return self._memory[key].payload
        path = self._path(key)
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        return None

    def put(self, key: str, payload: Any) -> None:
        """Store ``payload`` in memory and persist a disk snapshot (best effort)."""
        self._memory[key] = _CacheEntry(payload, time.time())
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            self._path(key).write_text(json.dumps(payload), encoding="utf-8")
        except OSError as exc:  # read-only / ephemeral filesystems
            logger.warning("Could not write cache snapshot %s: %s", key, exc)


class FPLApiClient:
    """Async client for the public FPL API with TTL caching and offline fallback.

    Every method returns ``(payload, from_cache_fallback)`` via `fetch`; the convenience
    wrappers return just the payload. If the network fails, the latest disk snapshot is
    served and `last_fallback` is set so callers can surface staleness to the UI.
    """

    BASE_URL: Final[str] = "https://fantasy.premierleague.com/api"
    TTL_BOOTSTRAP: Final[float] = 300.0
    TTL_FIXTURES: Final[float] = 900.0
    TTL_ENTRY: Final[float] = 300.0
    TTL_LIVE: Final[float] = 60.0
    HEADERS: Final[dict[str, str]] = {
        "User-Agent": "Mozilla/5.0 (FPL-Optimus academic project)",
        "Accept": "application/json",
    }

    def __init__(
        self,
        cache: CacheStore | None = None,
        client: httpx.AsyncClient | None = None,
        timeout: float = 15.0,
    ) -> None:
        self._cache = cache if cache is not None else CacheStore()
        self._client = client or httpx.AsyncClient(
            base_url=self.BASE_URL, headers=self.HEADERS, timeout=timeout, follow_redirects=True
        )
        self._locks: dict[str, asyncio.Lock] = {}
        self.last_fallback: bool = False

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> "FPLApiClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    def fetch_sync(self, path: str, ttl: float | None, getter: Any) -> Any:
        """Synchronous cache-and-fallback helper shared by `fetch` and unit tests."""
        cached = self._cache.get_fresh(path, ttl)
        if cached is not None:
            self.last_fallback = False
            return cached
        try:
            payload = getter(path)
        except (httpx.HTTPError, ValueError) as exc:
            stale = self._cache.get_stale(path)
            if stale is None:
                raise FPLApiError(f"FPL API request failed for {path}: {exc}") from exc
            logger.warning("Serving cached snapshot for %s (%s)", path, exc)
            self.last_fallback = True
            return stale
        self._cache.put(path, payload)
        self.last_fallback = False
        return payload

    async def fetch(self, path: str, ttl: float | None) -> Any:
        """GET ``path`` (relative to the API root) with caching and fallback."""
        cached = self._cache.get_fresh(path, ttl)
        if cached is not None:
            self.last_fallback = False
            return cached
        lock = self._locks.setdefault(path, asyncio.Lock())
        async with lock:
            cached = self._cache.get_fresh(path, ttl)
            if cached is not None:
                return cached
            try:
                resp = await self._client.get(path)
                resp.raise_for_status()
                payload = resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                stale = self._cache.get_stale(path)
                if stale is None:
                    raise FPLApiError(f"FPL API request failed for {path}: {exc}") from exc
                logger.warning("Serving cached snapshot for %s (%s)", path, exc)
                self.last_fallback = True
                return stale
            self._cache.put(path, payload)
            self.last_fallback = False
            return payload

    # ---- endpoint wrappers ----------------------------------------------------------
    async def get_bootstrap(self) -> dict[str, Any]:
        """``/bootstrap-static/``: players, teams, prices, availability, events."""
        return await self.fetch("/bootstrap-static/", self.TTL_BOOTSTRAP)

    async def get_fixtures(self) -> list[dict[str, Any]]:
        """``/fixtures/``: all season fixtures with FDR."""
        return await self.fetch("/fixtures/", self.TTL_FIXTURES)

    async def get_entry(self, team_id: int) -> dict[str, Any]:
        """``/entry/{id}/``: manager name, overall rank, points, team value."""
        return await self.fetch(f"/entry/{int(team_id)}/", self.TTL_ENTRY)

    async def get_entry_history(self, team_id: int) -> dict[str, Any]:
        """``/entry/{id}/history/``: per-GW history, past seasons, chips."""
        return await self.fetch(f"/entry/{int(team_id)}/history/", self.TTL_ENTRY)

    async def get_picks(self, team_id: int, gw: int) -> dict[str, Any]:
        """``/entry/{id}/event/{gw}/picks/``: 15 picks, captaincy, chip, bank."""
        return await self.fetch(f"/entry/{int(team_id)}/event/{int(gw)}/picks/", self.TTL_ENTRY)

    async def get_event_live(self, gw: int, finished: bool = False) -> dict[str, Any]:
        """``/event/{gw}/live/``: per-player matchday stats. Cached forever if finished."""
        return await self.fetch(f"/event/{int(gw)}/live/", None if finished else self.TTL_LIVE)


# --------------------------------------------------------------------------------------
# Live -> standard schema
# --------------------------------------------------------------------------------------
def current_season_label(bootstrap: dict[str, Any]) -> str:
    """Infer the season label (e.g. ``2026-27``) from the first event deadline."""
    first = pd.to_datetime(bootstrap["events"][0]["deadline_time"], utc=True)
    start = first.year if first.month >= 7 else first.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def current_gameweek(bootstrap: dict[str, Any]) -> tuple[int, int]:
    """Return ``(current_gw, next_gw)``; current is the latest started event."""
    events = bootstrap["events"]
    cur = next((e["id"] for e in events if e.get("is_current")), None)
    nxt = next((e["id"] for e in events if e.get("is_next")), None)
    if cur is None:
        cur = max((e["id"] for e in events if e.get("finished")), default=0)
    if nxt is None:
        nxt = min(cur + 1, len(events))
    return int(cur), int(nxt)


class LiveDataBuilder:
    """Converts live FPL API payloads into the standard match schema and prediction rows."""

    def __init__(self, api: FPLApiClient, features: FeatureEngineer | None = None) -> None:
        self._api = api
        self._features = features or FeatureEngineer()

    @staticmethod
    def players_frame(bootstrap: dict[str, Any]) -> pd.DataFrame:
        """Tidy player table from bootstrap-static ``elements``."""
        el = pd.DataFrame(bootstrap["elements"])
        teams = {t["id"]: t["short_name"] for t in bootstrap["teams"]}
        out = pd.DataFrame(
            {
                "element": el["id"].astype(int),
                "player_key": el["code"].astype(np.int64),
                "name": el["web_name"],
                "full_name": el["first_name"] + " " + el["second_name"],
                "position": el["element_type"].map(ELEMENT_TYPE_TO_POS),
                "team_id": el["team"].astype(int),
                "team_short": el["team"].map(teams),
                "price": el["now_cost"].astype(float) / 10.0,
                "status": el["status"],
                "chance_next": pd.to_numeric(el["chance_of_playing_next_round"], errors="coerce"),
                "news": el["news"].fillna(""),
                "selected_by_percent": pd.to_numeric(el["selected_by_percent"], errors="coerce"),
                "total_points": el["total_points"],
            }
        )
        return out

    async def season_history(self, bootstrap: dict[str, Any], fixtures: list[dict[str, Any]]) -> pd.DataFrame:
        """Rebuild per-(player, GW) match rows for all finished/started gameweeks.

        Double gameweeks are aggregated by the API into one row per player; we attribute
        the row to the player's first fixture of that GW (documented approximation).
        """
        season = current_season_label(bootstrap)
        players = self.players_frame(bootstrap).set_index("element")
        fx = pd.DataFrame(fixtures)
        teams = pd.DataFrame(bootstrap["teams"]).assign(season=season)
        started = [e for e in bootstrap["events"] if e.get("finished") or e.get("is_current")]
        payloads = await asyncio.gather(
            *[self._api.get_event_live(e["id"], finished=bool(e.get("finished"))) for e in started]
        )
        rows: list[dict[str, Any]] = []
        for event, payload in zip(started, payloads):
            gw = int(event["id"])
            for item in payload.get("elements", []):
                eid = int(item["id"])
                if eid not in players.index or not item.get("explain"):
                    continue
                fixture_id = int(item["explain"][0]["fixture"])
                s = item["stats"]
                rows.append({"gw": gw, "element": eid, "fixture": fixture_id, **s})
        if not rows:
            return pd.DataFrame()
        raw = pd.DataFrame(rows)
        raw = raw.merge(
            fx[["id", "team_h", "team_a", "team_h_difficulty", "team_a_difficulty", "kickoff_time", "finished"]]
            .rename(columns={"id": "fixture"}),
            on="fixture", how="left",
        )
        info = players.loc[raw["element"]]
        team_id = info["team_id"].to_numpy()
        home = (raw["team_h"].to_numpy() == team_id)
        df = pd.DataFrame(
            {
                "season": season,
                "gw": raw["gw"].astype(int),
                "element": raw["element"].astype(int),
                "player_key": info["player_key"].to_numpy(),
                "name": info["name"].to_numpy(),
                "position": info["position"].to_numpy(),
                "team_id": team_id,
                "opponent_team_id": np.where(home, raw["team_a"], raw["team_h"]).astype(int),
                "was_home": home.astype(int),
                "fixture": raw["fixture"].astype(int),
                "kickoff_time": pd.to_datetime(raw["kickoff_time"], utc=True),
                "value": info["price"].to_numpy(),
                "minutes": raw["minutes"],
                "total_points": raw["total_points"],
                "goals_scored": raw["goals_scored"],
                "assists": raw["assists"],
                "clean_sheets": raw["clean_sheets"],
                "goals_conceded": raw["goals_conceded"],
                "bonus": raw["bonus"],
                "bps": raw["bps"],
                "saves": raw["saves"],
                "starts": raw.get("starts", (raw["minutes"] >= 60).astype(int)),
                "xg": pd.to_numeric(raw["expected_goals"], errors="coerce"),
                "xa": pd.to_numeric(raw["expected_assists"], errors="coerce"),
                "xgc": pd.to_numeric(raw["expected_goals_conceded"], errors="coerce"),
                "cbi": raw.get("clearances_blocks_interceptions", np.nan),
                "tackles": raw.get("tackles", np.nan),
                "recoveries": raw.get("recoveries", np.nan),
                "defcon_available": "clearances_blocks_interceptions" in raw,
                "fdr": np.where(home, raw["team_h_difficulty"], raw["team_a_difficulty"]),
            }
        )
        df = attach_team_strength(df, teams)
        return add_defcon_columns(df)

    def upcoming_rows(
        self,
        bootstrap: dict[str, Any],
        fixtures: list[dict[str, Any]],
        history: pd.DataFrame,
        start_gw: int,
        horizon: int = 1,
    ) -> pd.DataFrame:
        """One feature row per (player, upcoming fixture) for GWs ``start_gw..start_gw+horizon-1``.

        Player/team states come from the latest completed matches in ``history``
        (which may include previous seasons so new-season form is not empty).
        Blank gameweeks produce no row; double gameweeks produce two.
        """
        season = current_season_label(bootstrap)
        players = self.players_frame(bootstrap)
        teams = pd.DataFrame(bootstrap["teams"]).assign(season=season)
        fx = pd.DataFrame(fixtures)
        gws = range(start_gw, start_gw + horizon)
        fx = fx[fx["event"].isin(list(gws))]

        sides = []
        for side, opp_side, home in (("team_h", "team_a", 1), ("team_a", "team_h", 0)):
            sides.append(
                pd.DataFrame(
                    {
                        "fixture": fx["id"].astype(int),
                        "gw": fx["event"].astype(int),
                        "team_id": fx[side].astype(int),
                        "opponent_team_id": fx[opp_side].astype(int),
                        "was_home": home,
                        "fdr": fx[f"{side}_difficulty"],
                        "kickoff_time": pd.to_datetime(fx["kickoff_time"], utc=True),
                    }
                )
            )
        team_fx = pd.concat(sides, ignore_index=True)
        rows = players.merge(team_fx, on="team_id", how="inner")
        rows["season"] = season
        rows["value"] = rows["price"]
        rows = attach_team_strength(rows, teams)

        if not history.empty:
            pstate = self._features.latest_player_state(history)
            rows = rows.merge(pstate, on="player_key", how="left")
            tstate = self._features.latest_team_state(history)
            rows = rows.merge(tstate, on="team_id", how="left")
            opp = tstate.rename(columns={"team_id": "opponent_team_id",
                                         **{c: f"opp_{c}" for c in FeatureEngineer.TEAM_STATE_COLS}})
            rows = rows.merge(opp, on="opponent_team_id", how="left")
        for col in feature_columns():
            if col not in rows and not col.startswith("pos_"):
                rows[col] = np.nan
        rows["matches_played"] = rows["matches_played"].fillna(0)
        return add_position_dummies(rows)


def availability_factor(status: pd.Series, chance_next: pd.Series) -> pd.Series:
    """Live availability multiplier: chance/100, 0 for injured/suspended/unavailable."""
    factor = (chance_next.fillna(100.0) / 100.0).clip(0.0, 1.0)
    factor = factor.where(~status.isin(["i", "u", "s", "n"]), 0.0)
    return factor.where(status.ne("d") | chance_next.notna(), 0.75)


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Build data/processed/features.csv from data/raw/")
    parser.parse_args()
    t0 = time.time()
    data = build_processed_dataset()
    print(f"Processed {len(data):,} rows x {data.shape[1]} cols in {time.time() - t0:.1f}s")
