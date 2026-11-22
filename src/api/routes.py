"""FastAPI route handlers for FPL-Optimus.

Exposes:
* `GET  /api/bootstrap`: Game metadata, deadline, optimal SA ceiling fitness, and full
  player pool with xP, DefCon probability, and active current-season GMM archetypes.
* `GET  /api/manager/{team_id}`: Manager details, overall rank, season history, and
  8-chip tracker (2x WC, 2x FH, 2x BB, 2x TC across half-season windows).
* `GET  /api/manager/{team_id}/squad`: Active 15 picks for any GW (with automatic
  fallback to latest active permanent picks when a future/unplayed GW is requested),
  GW Rating %, active chip scoring (3x Triple Captain / Bench Boost), and Suggested Captain.
* `GET  /api/live/{gw}`: Real-time matchday points, DefCon action counts, and BPS.
* `POST /api/optimize/build`: Wildcard / full squad builder using Simulated Annealing
  (5,000 iterations).
* `POST /api/optimize/transfers`: Optimal k-transfer plans from a manager's squad (free transfers + hits).
* `GET  /api/benchmarks`: Offline evaluation metrics, GMM summary, and convergence logs.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.agents import AGENTS, HillClimbingAgent
from src.data_loader import (
    DEFCON_THRESHOLD,
    FPLApiClient,
    FPLApiError,
    LiveDataBuilder,
    PROJECT_ROOT,
    availability_factor,
    current_gameweek,
    current_season_label,
    load_processed,
)
from src.environment import TransferOptimizer, build_player_pool
from src.models import MODELS_DIR, ModelBundle, season_player_aggregates
from src.squad import (
    BENCH_WEIGHT,
    DEFAULT_BUDGET,
    MAX_PER_CLUB,
    MIN_STARTERS,
    POS_NAMES,
    SQUAD_QUOTA,
    PlayerPool,
    SquadEvaluator,
    SquadState,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

RESULTS_DIR: Path = PROJECT_ROOT / "outputs" / "results"
BUNDLE_PATH: Path = MODELS_DIR / "bundle.joblib"


# ======================================================================================
# Request / Response schemas
# ======================================================================================
class BuildOptimizeRequest(BaseModel):
    budget: float = Field(default=DEFAULT_BUDGET, ge=60.0, le=150.0)
    algorithm: str = Field(default="sa", pattern="^(sa|hc|hc_norestart|greedy|random)$")
    horizon: int = Field(default=1, ge=1, le=5)
    iterations: int = Field(default=5_000, ge=100, le=20_000)
    seed: int = Field(default=2026)
    gw: int | None = Field(default=None, ge=1, le=38)
    excluded_elements: list[int] = Field(default_factory=list)


class TransferOptimizeRequest(BaseModel):
    squad_elements: list[int] = Field(..., min_length=15, max_length=15)
    bank: float = Field(default=0.0, ge=0.0, le=50.0)
    free_transfers: int = Field(default=1, ge=1, le=5)
    include_hits: bool = Field(default=True)
    max_extra_hits: int = Field(default=2, ge=0, le=3)
    horizon: int = Field(default=1, ge=1, le=5)
    gw: int | None = Field(default=None, ge=1, le=38)
    seed: int = Field(default=2026)
    excluded_elements: list[int] = Field(default_factory=list)


class EvaluateSquadRequest(BaseModel):
    starters: list[int] = Field(..., min_length=11, max_length=11)
    bench: list[int] = Field(..., min_length=4, max_length=4)
    captain: int
    vice_captain: int
    gw: int = Field(..., ge=1, le=38)
    budget: float = Field(default=DEFAULT_BUDGET, ge=60.0, le=150.0)
    active_chip: str | None = Field(default=None)
    free_transfers: int = Field(default=1, ge=1, le=5)
    n_transfers: int = Field(default=0, ge=0, le=15)
    enforce_constraints: bool = Field(default=False)


# ======================================================================================
# 8-Chip Season Status Helper (2x WC, 2x FH, 2x BB, 2x TC split at GW19/GW20)
# ======================================================================================
CHIP_DEFINITIONS: tuple[tuple[str, str, int, int], ...] = (
    ("wildcard", "WC1", 1, 19),
    ("wildcard", "WC2", 20, 38),
    ("freehit", "FH1", 1, 19),
    ("freehit", "FH2", 20, 38),
    ("bboost", "BB1", 1, 19),
    ("bboost", "BB2", 20, 38),
    ("3xc", "TC1", 1, 19),
    ("3xc", "TC2", 20, 38),
)


def build_chip_status(
    used_chips: list[dict[str, Any]],
    current_gw: int,
    selected_gw: int | None = None,
) -> list[dict[str, Any]]:
    """Build status for all 8 seasonal chips (WC1/2, FH1/2, BB1/2, TC1/2)."""
    by_type: dict[str, list[int]] = {}
    for ch in used_chips:
        cname = str(ch.get("name", "")).lower()
        ev = int(ch.get("event", 0) or 0)
        if cname and ev > 0:
            by_type.setdefault(cname, []).append(ev)
    for k in by_type:
        by_type[k].sort()

    out: list[dict[str, Any]] = []
    for api_name, label, start_gw, end_gw in CHIP_DEFINITIONS:
        events = by_type.get(api_name, [])
        used_gw: int | None = None
        for ev in events:
            if start_gw <= ev <= end_gw:
                used_gw = ev
                break
        if used_gw is not None:
            status = "active" if (selected_gw is not None and used_gw == selected_gw) else "used"
        elif current_gw > end_gw:
            status = "expired"
        else:
            status = "available"
        out.append({
            "chip": api_name,
            "label": label,
            "window": f"GW{start_gw}-{end_gw}",
            "status": status,
            "used_gw": used_gw,
        })
    return out


# ======================================================================================
# Application state & live/offline pool resolution
# ======================================================================================
@dataclass
class PoolSnapshot:
    pool: PlayerPool
    players_table: list[dict[str, Any]]
    season: str
    current_gw: int
    next_gw: int
    target_gw: int
    deadline_time: str | None
    from_fallback: bool
    source: str  # "live" or "offline_2025_26"
    optimal_fitness: float = 68.0


class AppService:
    """Singleton state managing the FPL API client, trained ModelBundle, and cached pools."""

    def __init__(self) -> None:
        self._api: FPLApiClient | None = None
        self._builder: LiveDataBuilder | None = None
        self._bundle: ModelBundle | None = None
        self._hist_df: pd.DataFrame | None = None
        self._pool_cache: dict[Any, PoolSnapshot] = {}
        self._sa_cache: dict[tuple[int, int, float], dict[str, Any]] = {}

    @property
    def api(self) -> FPLApiClient:
        if self._api is None:
            self._api = FPLApiClient()
        return self._api

    @property
    def builder(self) -> LiveDataBuilder:
        if self._builder is None:
            self._builder = LiveDataBuilder(self.api)
        return self._builder

    def get_bundle(self) -> ModelBundle:
        if self._bundle is None:
            if not BUNDLE_PATH.exists():
                from src.train_live import train_and_save_bundle

                self._bundle = train_and_save_bundle(offline_only=True, out_path=BUNDLE_PATH)
            else:
                self._bundle = ModelBundle.load(BUNDLE_PATH)
        return self._bundle

    def get_historical_df(self) -> pd.DataFrame:
        if self._hist_df is None:
            self._hist_df = load_processed()
        return self._hist_df

    def _enrich_with_archetypes(
        self,
        players_df: pd.DataFrame,
        profiles_source: pd.DataFrame,
        live_season: str | None = None,
    ) -> pd.DataFrame:
        """Assign GMM archetypes and per-90 scatter coordinates for active current-season players."""
        bundle = self.get_bundle()
        avail_seasons = set(profiles_source["season"].unique())

        prof_frames: list[pd.DataFrame] = []
        if live_season and live_season in avail_seasons:
            live_prof = season_player_aggregates(profiles_source, live_season, min_minutes=180)
            prof_frames.append(live_prof[live_prof["minutes"] >= 90])
        if bundle.profiles_season in avail_seasons:
            hist_prof = season_player_aggregates(profiles_source, bundle.profiles_season, min_minutes=360)
            prof_frames.append(hist_prof)

        if prof_frames:
            prof = pd.concat(prof_frames, ignore_index=True).drop_duplicates(subset=["player_key"], keep="first")
        else:
            fallback_s = str(profiles_source["season"].max())
            prof = season_player_aggregates(profiles_source, fallback_s, min_minutes=180)

        active_keys = set(players_df.loc[players_df["status"].ne("u"), "player_key"].astype(np.int64))
        prof = prof[prof["player_key"].isin(active_keys)].copy()

        price_map = dict(zip(players_df["player_key"].astype(np.int64), players_df["price"].astype(float)))
        prof["cost"] = prof["player_key"].map(price_map).fillna(prof["cost"])

        if not prof.empty:
            arche = bundle.clusterer.transform(prof)
            arche_cols = [
                "player_key", "archetype", "archetype_confidence",
                "p_defcon_anchor", "p_attacking_outlet", "posteriors",
            ]
            arche = arche[arche_cols].drop_duplicates(subset=["player_key"], keep="first")
            merged = players_df.merge(arche, on="player_key", how="left")
            p90 = prof[[
                "player_key", "xg_per90", "xa_per90", "cbit_per90",
                "cbirt_per90", "defcon_hit_rate", "clean_sheets_per90", "minutes", "low_sample",
            ]].drop_duplicates("player_key", keep="first")
            merged = merged.merge(p90, on="player_key", how="left")
        else:
            merged = players_df.copy()
            merged["archetype"] = "Unclassified"
            merged["archetype_confidence"] = 0.0
            merged["p_defcon_anchor"] = 0.0
            merged["p_attacking_outlet"] = 0.0
            merged["posteriors"] = [{} for _ in range(len(merged))]
            merged["low_sample"] = True

        merged["archetype"] = merged["archetype"].fillna("Unclassified")
        merged["archetype_confidence"] = merged["archetype_confidence"].fillna(0.0)
        merged["p_defcon_anchor"] = merged["p_defcon_anchor"].fillna(0.0)
        merged["p_attacking_outlet"] = merged["p_attacking_outlet"].fillna(0.0)
        merged["posteriors"] = merged["posteriors"].apply(lambda x: x if isinstance(x, dict) else {})
        merged["low_sample"] = merged["low_sample"].fillna(True)
        for c in ("xg_per90", "xa_per90", "cbit_per90", "cbirt_per90", "defcon_hit_rate", "clean_sheets_per90", "minutes"):
            if c not in merged:
                merged[c] = 0.0
            merged[c] = merged[c].fillna(0.0)
        return merged

    def run_sa_build(
        self,
        pool: PlayerPool,
        target_gw: int,
        horizon: int,
        budget: float = DEFAULT_BUDGET,
        iterations: int = 5_000,
        seed: int = 2026,
        optimal_ceiling: float | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        """Run Simulated Annealing (5,000 iterations) to build an optimal 15-man squad."""
        cache_key = (int(target_gw), int(horizon), round(float(budget), 1))
        if not force and cache_key in self._sa_cache:
            return self._sa_cache[cache_key]

        ev = SquadEvaluator(pool, budget=float(budget))
        excluded_idx: set[int] = set()
        if "status" in pool.frame:
            excluded_idx.update(np.flatnonzero(pool.frame["status"].isin(["n", "u"]).to_numpy()).tolist())

        agent = AGENTS["sa"](
            ev,
            iterations=iterations,
            max_evals=iterations + 1,
            seed=seed,
            excluded=excluded_idx,
        )
        res = agent.select()
        ceil_fitness = max(float(res.fitness), float(optimal_ceiling or res.fitness))
        squad_desc = _describe_squad(ev, res.state, optimal_fitness=ceil_fitness)
        end_gw = min(38, int(target_gw) + int(horizon) - 1)
        n_gws = max(1, end_gw - int(target_gw) + 1)
        squad_desc["n_gws"] = n_gws
        squad_desc["avg_gw_points"] = round(float(squad_desc["projected_points"]) / n_gws, 2)
        squad_desc["horizon_gws"] = list(range(int(target_gw), end_gw + 1))

        payload = {
            "algorithm": res.agent,
            "iterations": iterations,
            "horizon": int(horizon),
            "n_gws": n_gws,
            "start_gw": int(target_gw),
            "end_gw": end_gw,
            "budget": round(float(budget), 1),
            "evaluations": res.evaluations,
            "runtime_s": round(res.runtime_s, 3),
            "optimal_fitness": round(ceil_fitness, 2),
            "squad": squad_desc,
            "convergence": res.downsampled_history(max_points=200),
        }
        self._sa_cache[cache_key] = payload
        return payload

    def _compute_optimal_ceiling(self, pool: PlayerPool, target_gw: int, horizon: int) -> float:
        """Compute reference 5,000-iteration SA optimal £100m squad fitness used as 100% GW Rating ceiling."""
        try:
            built = self.run_sa_build(
                pool=pool,
                target_gw=target_gw,
                horizon=horizon,
                budget=DEFAULT_BUDGET,
                iterations=5_000,
                seed=2026,
            )
            return max(1.0, float(built["optimal_fitness"]))
        except Exception:
            return 65.0

    def _build_offline_snapshot(self, horizon: int = 1, target_gw: int = 30) -> PoolSnapshot:
        """Fallback snapshot from 2025-26 historical data when live API is unreachable."""
        df = self.get_historical_df()
        bundle = self.get_bundle()
        season = "2025-26"
        sdf = df[df["season"] == season]
        max_gw = int(sdf["gw"].max())
        gw = min(max(1, target_gw), max_gw)
        horizon_gws = list(range(gw, min(gw + horizon, max_gw + 1)))

        latest = sdf[sdf["gw"] <= gw].sort_values(["gw", "kickoff_time"]).groupby("element").last().reset_index()
        teams_path = PROJECT_ROOT / "data" / "raw" / season / "teams.csv"
        teams_map: dict[int, str] = {}
        if teams_path.exists():
            tdf = pd.read_csv(teams_path)
            teams_map = dict(zip(tdf["id"].astype(int), tdf["short_name"].astype(str)))

        players = pd.DataFrame({
            "element": latest["element"].astype(int),
            "player_key": latest["player_key"].astype(np.int64),
            "name": latest["name"].astype(str),
            "full_name": latest["name"].astype(str),
            "position": latest["position"].astype(str),
            "team_id": latest["team_id"].astype(int),
            "team_short": latest["team_id"].map(teams_map).fillna("FPL"),
            "price": latest["value"].astype(float),
            "status": "a",
            "chance_next": 100.0,
            "news": "",
            "selected_by_percent": 5.0,
            "total_points": sdf[sdf["gw"] < gw].groupby("element")["total_points"].sum().reindex(latest["element"]).fillna(0).to_numpy(dtype=int),
            "availability": np.where(latest["minutes_roll3"].fillna(90.0) > 0, 1.0, 0.25),
        })

        fx_rows = sdf[sdf["gw"].isin(horizon_gws)].copy()
        preds = bundle.predict_fixtures(fx_rows)

        next_fx = sdf[sdf["gw"] == gw].groupby("element").first()
        players["fdr"] = players["element"].map(next_fx["fdr"]).fillna(3).astype(int)
        players["was_home"] = players["element"].map(next_fx["was_home"]).fillna(1).astype(int)
        opp_id = players["element"].map(next_fx["opponent_team_id"]).fillna(0).astype(int)
        players["opponent_short"] = opp_id.map(teams_map).fillna("TBD")

        players = self._enrich_with_archetypes(players, sdf[sdf["gw"] <= gw], live_season=season)
        pool = build_player_pool(preds, players)
        return self._finalize_snapshot(pool, season, gw, min(gw + 1, 38), gw, None, True, "offline_2025_26", horizon=horizon)

    def _finalize_snapshot(
        self,
        pool: PlayerPool,
        season: str,
        cur_gw: int,
        nxt_gw: int,
        target_gw: int,
        deadline: str | None,
        fallback: bool,
        source: str,
        horizon: int = 1,
    ) -> PoolSnapshot:
        f = pool.frame.copy()
        f["xp"] = pool.value
        clean_df = f.astype(object).where(pd.notna(f), None)
        records = clean_df.to_dict(orient="records")
        opt_f = self._compute_optimal_ceiling(pool, target_gw=target_gw, horizon=horizon)
        return PoolSnapshot(pool, records, season, cur_gw, nxt_gw, target_gw, deadline, fallback, source, opt_f)

    async def get_pool_snapshot(self, horizon: int = 1, target_gw: int | None = None) -> PoolSnapshot:
        """Build or return a cached `PoolSnapshot` for `(horizon, target_gw)`."""
        if target_gw is None and horizon in self._pool_cache:
            return self._pool_cache[horizon]
        cache_key = (horizon, int(target_gw or 0))
        if cache_key in self._pool_cache:
            return self._pool_cache[cache_key]
        try:
            bootstrap = await self.api.get_bootstrap()
            fixtures = await self.api.get_fixtures()
            season = current_season_label(bootstrap)
            cur_gw, nxt_gw = current_gameweek(bootstrap)
            start_gw = int(target_gw) if target_gw is not None else nxt_gw
            resolved_key = (horizon, start_gw)
            if resolved_key in self._pool_cache:
                return self._pool_cache[resolved_key]

            events = bootstrap.get("events", [])
            ev_obj = next((e for e in events if int(e["id"]) == start_gw), events[0] if events else {})
            deadline = ev_obj.get("deadline_time")

            live_hist = await self.builder.season_history(bootstrap, fixtures)
            hist_df = self.get_historical_df()
            combined = (
                pd.concat([hist_df[hist_df["season"] != season], live_hist], ignore_index=True)
                if not live_hist.empty
                else hist_df
            )

            hist_for_gw = combined[
                (combined["season"] != season) | (combined["gw"] <= max(1, start_gw))
            ]
            upcoming = self.builder.upcoming_rows(
                bootstrap, fixtures, hist_for_gw, start_gw=start_gw, horizon=horizon
            )
            bundle = self.get_bundle()
            preds = (
                bundle.predict_fixtures(upcoming)
                if not upcoming.empty
                else pd.DataFrame(columns=["element", "xp_base", "p_defcon"])
            )

            players = self.builder.players_frame(bootstrap)
            players["availability"] = availability_factor(players["status"], players["chance_next"])

            teams_map = {int(t["id"]): str(t["short_name"]) for t in bootstrap.get("teams", [])}
            if not upcoming.empty:
                nxt_fx = upcoming[upcoming["gw"] == start_gw].groupby("element").first()
                players["fdr"] = players["element"].map(nxt_fx["fdr"]).fillna(3).astype(int)
                players["was_home"] = players["element"].map(nxt_fx["was_home"]).fillna(1).astype(int)
                opp_id = players["element"].map(nxt_fx["opponent_team_id"]).fillna(0).astype(int)
                players["opponent_short"] = opp_id.map(teams_map).fillna("BLNK")
            else:
                players["fdr"] = 3
                players["was_home"] = 1
                players["opponent_short"] = "TBD"

            players = self._enrich_with_archetypes(players, combined, live_season=season)
            pool = build_player_pool(preds, players)
            snap = self._finalize_snapshot(
                pool, season, cur_gw, nxt_gw, start_gw, deadline, self.api.last_fallback, "live", horizon=horizon
            )
            self._pool_cache[cache_key] = snap
            self._pool_cache[resolved_key] = snap
            return snap
        except (FPLApiError, Exception) as exc:
            logger.warning("Falling back to offline 2025-26 pool (%s)", exc)
            snap = self._build_offline_snapshot(horizon=horizon, target_gw=target_gw or 30)
            self._pool_cache[cache_key] = snap
            return snap


service = AppService()


def _gw_rating_pct(fitness: float, optimal_fitness: float) -> int:
    """Compute a 0–100% GW Rating relative to the AI optimal SA squad for that GW."""
    if optimal_fitness <= 0 or fitness <= 0:
        return 0
    return int(min(100, max(1, round(100.0 * (fitness / optimal_fitness)))))


def _decorate_card(card: dict[str, Any], pool: PlayerPool) -> dict[str, Any]:
    """Attach fixture, archetype, and availability metadata from `pool.frame` to a squad card."""
    idx = pool.index_of(int(card["element"]))
    row = pool.frame.iloc[idx]
    for col in (
        "fdr", "was_home", "opponent_short", "status", "news",
        "archetype", "archetype_confidence", "p_defcon_anchor", "p_attacking_outlet",
        "xg_per90", "xa_per90", "cbit_per90", "cbirt_per90", "defcon_hit_rate", "total_points", "low_sample",
    ):
        if col in row:
            val = row[col]
            card[col] = val.item() if hasattr(val, "item") else val
    return card


def _describe_squad(
    evaluator: SquadEvaluator,
    state: SquadState,
    optimal_fitness: float = 68.0,
    active_chip: str | None = None,
) -> dict[str, Any]:
    desc = evaluator.describe(state)
    starters = [_decorate_card(c, evaluator.pool) for c in desc["starters"]]  # type: ignore[union-attr]
    bench = [_decorate_card(c, evaluator.pool) for c in desc["bench"]]  # type: ignore[union-attr]

    all_cards = starters + bench
    suggested_cap = max(all_cards, key=lambda c: float(c.get("xp", 0.0)))
    for c in starters:
        c["is_suggested_captain"] = int(c["element"]) == int(suggested_cap["element"])
        if c.get("is_captain"):
            c["multiplier"] = 3 if active_chip == "3xc" else 2
        else:
            c["multiplier"] = 1
    for c in bench:
        c["is_suggested_captain"] = int(c["element"]) == int(suggested_cap["element"])
        c["multiplier"] = 1 if active_chip == "bboost" else 0

    starters_xp = sum(float(c["xp"]) * int(c.get("multiplier", 1)) for c in starters)
    bench_xp = sum(float(c["xp"]) for c in bench)
    projected_points = starters_xp + (bench_xp if active_chip == "bboost" else 0.0)

    desc["starters"] = starters
    desc["bench"] = bench
    desc["projected_points"] = round(projected_points, 2)
    desc["gw_rating_pct"] = _gw_rating_pct(float(desc["fitness"]), optimal_fitness)
    desc["active_chip"] = active_chip
    desc["suggested_captain"] = {
        "element": int(suggested_cap["element"]),
        "name": str(suggested_cap["name"]),
        "position": str(suggested_cap["position"]),
        "team_short": str(suggested_cap.get("team_short", "")),
        "xp": round(float(suggested_cap["xp"]), 2),
    }
    return desc


# ======================================================================================
# Endpoints
# ======================================================================================
@router.get("/bootstrap")
async def get_bootstrap(
    horizon: int = Query(default=1, ge=1, le=5),
    gw: int | None = Query(default=None, ge=1, le=38),
) -> dict[str, Any]:
    """Gameweek metadata, GMM cluster summary, and active current-season player pool."""
    snap = await service.get_pool_snapshot(horizon=horizon, target_gw=gw)
    bundle = service.get_bundle()
    active_gmm_players = [
        p for p in snap.players_table
        if p.get("status") != "u"
        and not p.get("low_sample", False)
        and p.get("archetype") not in (None, "Unclassified")
    ]
    return {
        "season": snap.season,
        "current_gw": snap.current_gw,
        "next_gw": snap.next_gw,
        "target_gw": snap.target_gw,
        "deadline_time": snap.deadline_time,
        "horizon": horizon,
        "optimal_fitness": round(snap.optimal_fitness, 2),
        "source": snap.source,
        "from_cache_fallback": snap.from_fallback,
        "trained_through": bundle.trained_through,
        "gmm_summary": bundle.clusterer.summary().assign(
            bic=lambda d: d["bic"].apply(lambda b: {str(k): round(float(v), 1) for k, v in b.items()})
        ).to_dict(orient="records"),
        "players": snap.players_table,
        "gmm_players": active_gmm_players,
    }


@router.get("/manager/{team_id}")
async def get_manager(
    team_id: int,
    gw: int | None = Query(default=None, ge=1, le=38),
) -> dict[str, Any]:
    """Fetch manager profile, overall rank, total points, and 8-chip status."""
    try:
        entry, history = await asyncio.gather(
            service.api.get_entry(team_id),
            service.api.get_entry_history(team_id),
        )
    except FPLApiError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    cur_ev = int(entry.get("current_event") or 1)
    used_chips = history.get("chips", [])
    chip_status = build_chip_status(used_chips, current_gw=cur_ev, selected_gw=gw or cur_ev)

    return {
        "team_id": team_id,
        "manager_name": f"{entry.get('player_first_name', '')} {entry.get('player_last_name', '')}".strip(),
        "team_name": entry.get("name", ""),
        "region": entry.get("player_region_name", ""),
        "started_event": entry.get("started_event", 1),
        "current_event": cur_ev,
        "overall_points": entry.get("summary_overall_points", 0),
        "overall_rank": entry.get("summary_overall_rank"),
        "event_points": entry.get("summary_event_points", 0),
        "event_rank": entry.get("summary_event_rank"),
        "value": (entry.get("last_deadline_value") or 1000) / 10.0,
        "bank": (entry.get("last_deadline_bank") or 0) / 10.0,
        "total_transfers": entry.get("last_deadline_total_transfers", 0),
        "current_season_history": history.get("current", []),
        "chips": used_chips,
        "chip_status": chip_status,
        "past_seasons": history.get("past", []),
        "from_cache_fallback": service.api.last_fallback,
    }


@router.get("/manager/{team_id}/squad")
async def get_manager_squad(
    team_id: int,
    gw: int | None = Query(default=None, ge=1, le=38),
    horizon: int = Query(default=1, ge=1, le=5),
) -> dict[str, Any]:
    """Extract the manager's 15 picks for `gw` (falling back to latest active picks if `gw` is in the future)."""
    base_snap = await service.get_pool_snapshot(horizon=horizon)
    requested_gw = int(gw) if gw is not None else max(1, base_snap.current_gw)
    snap = await service.get_pool_snapshot(horizon=horizon, target_gw=requested_gw)

    is_future_projection = False
    picks_source_gw = requested_gw
    picks_payload: dict[str, Any] | None = None

    if requested_gw <= max(1, snap.current_gw):
        try:
            picks_payload = await service.api.get_picks(team_id, requested_gw)
        except FPLApiError:
            picks_payload = None

    if picks_payload is None:
        is_future_projection = True
        fallback_gw = max(1, snap.current_gw)
        try:
            picks_payload = await service.api.get_picks(team_id, fallback_gw)
            picks_source_gw = fallback_gw
            if picks_payload.get("active_chip") == "freehit" and fallback_gw > 1:
                try:
                    pre_fh = await service.api.get_picks(team_id, fallback_gw - 1)
                    picks_payload = pre_fh
                    picks_source_gw = fallback_gw - 1
                except FPLApiError:
                    pass
        except FPLApiError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Could not fetch manager squad for team {team_id} (tried GW{requested_gw} and GW{fallback_gw}): {exc}",
            ) from exc

    used_chips: list[dict[str, Any]] = []
    try:
        hist = await service.api.get_entry_history(team_id)
        used_chips = hist.get("chips", [])
    except FPLApiError:
        pass

    active_chip = None if is_future_projection else picks_payload.get("active_chip")
    picks = sorted(picks_payload.get("picks", []), key=lambda p: int(p.get("position", 1)))
    elements = [int(p["element"]) for p in picks]
    entry_hist = picks_payload.get("entry_history", {})
    bank = float(entry_hist.get("bank", 0)) / 10.0
    squad_value = float(entry_hist.get("value", 1000)) / 10.0

    pool = snap.pool
    try:
        indices = pool.indices_of(elements)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"Unknown player element in squad: {exc}") from exc

    state = SquadState.of(indices)
    budget = float(pool.price[indices].sum()) + bank
    ev = SquadEvaluator(pool, budget=budget)

    ai_desc = _describe_squad(ev, state, optimal_fitness=snap.optimal_fitness, active_chip=active_chip)
    suggested_cap = ai_desc["suggested_captain"]

    mgr_starters: list[dict[str, Any]] = []
    mgr_bench: list[dict[str, Any]] = []
    chosen_cap_card: dict[str, Any] | None = None
    for p in picks:
        idx = pool.index_of(int(p["element"]))
        row = pool.frame.iloc[idx]
        pos_slot = int(p.get("position", 1))
        is_cap = bool(p.get("is_captain"))
        is_vc = bool(p.get("is_vice_captain"))
        mult = int(p.get("multiplier", 1))
        if is_future_projection:
            mult = 2 if is_cap else (1 if pos_slot <= 11 else 0)
        card = _decorate_card(
            {
                "element": int(row["element"]),
                "name": str(row["name"]),
                "position": str(row["position"]),
                "team_id": int(row["team_id"]),
                "team_short": str(row.get("team_short", "")),
                "price": float(row["price"]),
                "xp_base": float(pool.xp_base[idx]),
                "p_defcon": float(pool.p_defcon[idx]),
                "xp": float(pool.value[idx]),
                "role": "starter" if pos_slot <= 11 else f"bench{pos_slot - 12}",
                "is_captain": is_cap,
                "is_vice_captain": is_vc,
                "is_suggested_captain": int(row["element"]) == int(suggested_cap["element"]),
                "multiplier": mult,
            },
            pool,
        )
        if is_cap:
            chosen_cap_card = card
        if pos_slot <= 11:
            mgr_starters.append(card)
        else:
            mgr_bench.append(card)

    mgr_starters_xp = sum(float(c["xp"]) * int(c.get("multiplier", 1)) for c in mgr_starters)
    mgr_bench_xp = sum(float(c["xp"]) for c in mgr_bench)
    mgr_projected_points = mgr_starters_xp + (mgr_bench_xp if active_chip == "bboost" else 0.0)
    mgr_fitness = sum(float(c["xp"]) for c in mgr_starters) + (
        float(chosen_cap_card["xp"]) if chosen_cap_card else 0.0
    ) + 0.1 * mgr_bench_xp
    mgr_rating_pct = _gw_rating_pct(mgr_fitness, snap.optimal_fitness)

    n_pos = [0, 0, 0, 0]
    for c in mgr_starters:
        pos_str = str(c["position"])
        if pos_str == "DEF":
            n_pos[1] += 1
        elif pos_str == "MID":
            n_pos[2] += 1
        elif pos_str == "FWD":
            n_pos[3] += 1
    mgr_formation = f"{n_pos[1]}-{n_pos[2]}-{n_pos[3]}"

    return {
        "team_id": team_id,
        "gw": requested_gw,
        "picks_source_gw": picks_source_gw,
        "is_future_projection": is_future_projection,
        "active_chip": active_chip,
        "chip_status": build_chip_status(used_chips, current_gw=snap.current_gw, selected_gw=requested_gw),
        "bank": round(bank, 1),
        "reported_value": round(squad_value, 1),
        "selling_budget": round(budget, 1),
        "optimal_fitness": round(snap.optimal_fitness, 2),
        "squad_elements": elements,
        "suggested_captain": {
            **suggested_cap,
            "current_captain_name": chosen_cap_card["name"] if chosen_cap_card else "None",
            "current_captain_xp": round(float(chosen_cap_card["xp"]), 2) if chosen_cap_card else 0.0,
            "delta_xp": round(
                float(suggested_cap["xp"]) - (float(chosen_cap_card["xp"]) if chosen_cap_card else 0.0), 2
            ),
        },
        "manager_lineup": {
            "starters": mgr_starters,
            "bench": mgr_bench,
            "fitness": round(mgr_fitness, 2),
            "projected_points": round(mgr_projected_points, 2),
            "gw_rating_pct": mgr_rating_pct,
            "formation": mgr_formation,
            "cost": ai_desc["cost"],
            "bank": round(bank, 1),
            "active_chip": active_chip,
            "suggested_captain": ai_desc["suggested_captain"],
        },
        "ai_optimal_lineup": ai_desc,
        "from_cache_fallback": service.api.last_fallback,
    }


@router.get("/live/{gw}")
async def get_live_gw(gw: int) -> dict[str, Any]:
    """Real-time matchday points, goals, assists, BPS, and DefCon tracking for ``gw``."""
    snap = await service.get_pool_snapshot(horizon=1)
    if gw > snap.current_gw and snap.source == "live":
        return {
            "gw": gw,
            "is_future": True,
            "source": "live",
            "from_cache_fallback": False,
            "elements": [],
        }

    pool = snap.pool
    info_by_el = pool.frame.set_index("element")

    try:
        payload = await service.api.get_event_live(gw, finished=(gw < snap.current_gw))
        elements_live = payload.get("elements", [])
        live_rows: list[dict[str, Any]] = []
        for item in elements_live:
            eid = int(item["id"])
            s = item.get("stats", {})
            cbi = int(s.get("clearances_blocks_interceptions", 0) or 0)
            tackles = int(s.get("tackles", 0) or 0)
            recoveries = int(s.get("recoveries", 0) or 0)
            cbit = cbi + tackles
            cbirt = cbit + recoveries
            pos = str(info_by_el.loc[eid, "position"]) if eid in info_by_el.index else "MID"
            name = str(info_by_el.loc[eid, "name"]) if eid in info_by_el.index else f"Player #{eid}"
            team_short = str(info_by_el.loc[eid, "team_short"]) if eid in info_by_el.index else ""
            defcon_count = 0 if pos == "GK" else (cbit if pos == "DEF" else cbirt)
            threshold = DEFCON_THRESHOLD.get(pos, 12)
            defcon_hit = bool(pos != "GK" and defcon_count >= threshold)
            live_rows.append({
                "element": eid,
                "name": name,
                "position": pos,
                "team_short": team_short,
                "minutes": int(s.get("minutes", 0) or 0),
                "total_points": int(s.get("total_points", 0) or 0),
                "goals_scored": int(s.get("goals_scored", 0) or 0),
                "assists": int(s.get("assists", 0) or 0),
                "clean_sheets": int(s.get("clean_sheets", 0) or 0),
                "bps": int(s.get("bps", 0) or 0),
                "bonus": int(s.get("bonus", 0) or 0),
                "cbit": cbit,
                "cbirt": cbirt,
                "defcon_count": defcon_count,
                "defcon_threshold": None if pos == "GK" else int(threshold),
                "defcon_hit": defcon_hit,
            })
        return {
            "gw": gw,
            "is_future": False,
            "source": "live",
            "from_cache_fallback": service.api.last_fallback,
            "elements": live_rows,
        }
    except FPLApiError:
        df = service.get_historical_df()
        sub = df[(df["season"] == "2025-26") & (df["gw"] == min(max(1, gw), 38))]
        rows = []
        for _, r in sub.iterrows():
            pos = str(r["position"])
            thresh = DEFCON_THRESHOLD.get(pos, 12)
            rows.append({
                "element": int(r["element"]),
                "name": str(r["name"]),
                "position": pos,
                "team_short": "",
                "minutes": int(r["minutes"]),
                "total_points": int(r["total_points"]),
                "goals_scored": int(r["goals_scored"]),
                "assists": int(r["assists"]),
                "clean_sheets": int(r["clean_sheets"]),
                "bps": int(r["bps"]),
                "bonus": int(r["bonus"]),
                "cbit": int(0 if pd.isna(r["cbit"]) else r["cbit"]),
                "cbirt": int(0 if pd.isna(r["cbirt"]) else r["cbirt"]),
                "defcon_count": int(0 if pd.isna(r["defcon"]) else r["defcon"]),
                "defcon_threshold": None if pos == "GK" else int(thresh),
                "defcon_hit": bool(r["defcon_hit"] == 1.0) if not pd.isna(r["defcon_hit"]) else False,
            })
        return {
            "gw": gw,
            "is_future": False,
            "source": "offline_2025_26",
            "from_cache_fallback": True,
            "elements": rows,
        }


@router.post("/optimize/build")
async def optimize_build(req: BuildOptimizeRequest) -> dict[str, Any]:
    """Run Simulated Annealing (5,000 iterations default) to build an optimal 15-man squad."""
    snap = await service.get_pool_snapshot(horizon=req.horizon, target_gw=req.gw)
    pool = snap.pool
    ev = SquadEvaluator(pool, budget=req.budget)

    excluded_idx = {pool.index_of(e) for e in req.excluded_elements if e in pool._index_of}
    if "status" in pool.frame:
        unavailable = np.flatnonzero(pool.frame["status"].isin(["n", "u"]).to_numpy()).tolist()
        excluded_idx.update(unavailable)

    def _run_sync() -> dict[str, Any]:
        if req.algorithm == "sa":
            agent = AGENTS["sa"](ev, iterations=req.iterations, max_evals=req.iterations + 1, seed=req.seed, excluded=excluded_idx)
        elif req.algorithm == "hc":
            agent = HillClimbingAgent(ev, restarts=True, max_evals=req.iterations, seed=req.seed, excluded=excluded_idx)
        elif req.algorithm == "hc_norestart":
            agent = HillClimbingAgent(ev, restarts=False, max_evals=req.iterations, seed=req.seed, excluded=excluded_idx)
        elif req.algorithm == "greedy":
            agent = AGENTS["greedy"](ev, seed=req.seed, excluded=excluded_idx)
        else:
            agent = AGENTS["random"](ev, max_evals=req.iterations, seed=req.seed, excluded=excluded_idx)

        res = agent.select()
        opt_ceil = max(snap.optimal_fitness, float(res.fitness))
        squad_desc = _describe_squad(ev, res.state, optimal_fitness=opt_ceil)
        return {
            "algorithm": res.agent,
            "horizon": req.horizon,
            "budget": req.budget,
            "evaluations": res.evaluations,
            "runtime_s": round(res.runtime_s, 3),
            "meta": res.meta,
            "squad": squad_desc,
            "convergence": res.downsampled_history(max_points=200),
        }

    return _run_sync()


@router.post("/optimize/transfers")
async def optimize_transfers(req: TransferOptimizeRequest) -> dict[str, Any]:
    """Compute top optimal transfer plans (within free transfers and with -4pt hits)."""
    snap = await service.get_pool_snapshot(horizon=req.horizon, target_gw=req.gw)
    pool = snap.pool
    try:
        origin_indices = pool.indices_of(req.squad_elements)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"Unknown player element in squad_elements: {exc}") from exc

    origin = SquadState.of(origin_indices)
    excluded_idx = {pool.index_of(e) for e in req.excluded_elements if e in pool._index_of}
    if "status" in pool.frame:
        unavailable = np.flatnonzero(pool.frame["status"].isin(["n", "u"]).to_numpy()).tolist()
        excluded_idx.update(unavailable)

    def _run_sync() -> dict[str, Any]:
        opt = TransferOptimizer(
            pool=pool,
            origin=origin,
            bank=req.bank,
            free_transfers=req.free_transfers,
            seed=req.seed,
            excluded=excluded_idx,
        )
        max_k = req.free_transfers + (req.max_extra_hits if req.include_hits else 0)
        res = opt.optimize(max_transfers=max_k, top_per_k=5)

        def _format_plan(p: Any) -> dict[str, Any]:
            new_state = origin.replace_many(p.outs, p.ins)
            lineup_desc = _describe_squad(opt.evaluator, new_state, optimal_fitness=snap.optimal_fitness)
            transfers = []
            for o, i in zip(p.outs, p.ins):
                ro = pool.frame.iloc[o]
                ri = pool.frame.iloc[i]
                transfers.append({
                    "out": _decorate_card({
                        "element": int(ro["element"]), "name": str(ro["name"]), "position": str(ro["position"]),
                        "team_id": int(ro["team_id"]), "team_short": str(ro.get("team_short", "")),
                        "price": float(ro["price"]), "xp_base": float(pool.xp_base[o]),
                        "p_defcon": float(pool.p_defcon[o]), "xp": float(pool.value[o]),
                    }, pool),
                    "in": _decorate_card({
                        "element": int(ri["element"]), "name": str(ri["name"]), "position": str(ri["position"]),
                        "team_id": int(ri["team_id"]), "team_short": str(ri.get("team_short", "")),
                        "price": float(ri["price"]), "xp_base": float(pool.xp_base[i]),
                        "p_defcon": float(pool.p_defcon[i]), "xp": float(pool.value[i]),
                    }, pool),
                    "delta_xp": round(float(pool.value[i] - pool.value[o]), 2),
                    "delta_price": round(float(ro["price"] - ri["price"]), 1),
                })
            return {
                "n_transfers": p.n_transfers,
                "hits": p.hits,
                "hit_cost": p.hits * 4,
                "gross_gain": round(p.gross_gain, 2),
                "net_gain": round(p.net_gain, 2),
                "new_fitness": round(p.fitness, 2),
                "new_gw_rating_pct": lineup_desc["gw_rating_pct"],
                "bank_after": round(p.bank, 1),
                "transfers": transfers,
                "resulting_squad": lineup_desc,
            }

        free_plans = [_format_plan(p) for p in res.plans if p.hits == 0]
        hit_plans = [_format_plan(p) for p in res.plans if p.hits > 0]
        base_desc = _describe_squad(opt.evaluator, origin, optimal_fitness=snap.optimal_fitness)
        return {
            "base_fitness": round(res.base_fitness, 2),
            "base_gw_rating_pct": base_desc["gw_rating_pct"],
            "base_squad": base_desc,
            "free_transfers": req.free_transfers,
            "horizon": req.horizon,
            "recommended_free_plans": free_plans,
            "recommended_hit_plans": hit_plans if req.include_hits else [],
            "all_plans": [_format_plan(p) for p in res.plans],
        }

    return _run_sync()


@router.get("/optimus/squads")
async def get_optimus_squads(
    gw: int | None = Query(default=None, ge=1, le=38),
    budget: float = Query(default=DEFAULT_BUDGET, ge=60.0, le=150.0),
    force: bool = Query(default=False),
) -> dict[str, Any]:
    """Return both 5,000-iteration Simulated Annealing squads:
    * Optimus Freehit (Next 1 GW from `anchor_gw`)
    * Optimus Wildcard (Next 5 GWs from `anchor_gw`)
    """
    base_snap = await service.get_pool_snapshot(horizon=1)
    anchor_gw = base_snap.next_gw if (gw is None or gw <= base_snap.current_gw) else int(gw)
    fh_snap = await service.get_pool_snapshot(horizon=1, target_gw=anchor_gw)
    wc_snap = await service.get_pool_snapshot(horizon=5, target_gw=anchor_gw)

    fh_res = service.run_sa_build(
        fh_snap.pool,
        target_gw=anchor_gw,
        horizon=1,
        budget=budget,
        iterations=5_000,
        seed=2026,
        optimal_ceiling=fh_snap.optimal_fitness,
        force=force,
    )
    wc_res = service.run_sa_build(
        wc_snap.pool,
        target_gw=anchor_gw,
        horizon=5,
        budget=budget,
        iterations=5_000,
        seed=2026,
        optimal_ceiling=wc_snap.optimal_fitness,
        force=force,
    )
    return {
        "anchor_gw": anchor_gw,
        "current_gw": base_snap.current_gw,
        "next_gw": base_snap.next_gw,
        "budget": round(float(budget), 1),
        "freehit": fh_res,
        "wildcard": wc_res,
    }


@router.post("/squad/evaluate")
async def evaluate_squad(req: EvaluateSquadRequest) -> dict[str, Any]:
    """Evaluate a user-picked or manually transferred 15-man squad on a target GW.

    Supports exploratory preview (`enforce_constraints=False`, returning projected points &
    GW Rating % even when over budget or >3 per club) as well as strict FPL confirmation
    (`enforce_constraints=True`).
    """
    snap = await service.get_pool_snapshot(horizon=1, target_gw=req.gw)
    pool = snap.pool
    all_elements = list(req.starters) + list(req.bench)
    try:
        starter_idx = pool.indices_of(req.starters)
        bench_idx = pool.indices_of(req.bench)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"Unknown player element in squad: {exc}") from exc

    all_idx = starter_idx + bench_idx
    violations: list[str] = []

    if len(set(all_elements)) != 15:
        violations.append("Duplicate players detected in squad.")

    # 2-5-5-3 position quota across 15
    pos_counts = [0, 0, 0, 0]
    for i in all_idx:
        pos_counts[pool.pos_l[i]] += 1
    for p, (have, need) in enumerate(zip(pos_counts, SQUAD_QUOTA)):
        if have != need:
            violations.append(f"{POS_NAMES[p]} count is {have} (must be {need}).")

    # Max 3 players per Premier League club
    club_counts: dict[int, int] = {}
    for i in all_idx:
        t = pool.team_l[i]
        club_counts[t] = club_counts.get(t, 0) + 1
    for t_id, cnt in club_counts.items():
        if cnt > MAX_PER_CLUB:
            sample_row = pool.frame[pool.frame["team_id"] == t_id].iloc[0]
            t_short = str(sample_row.get("team_short") or f"Team {t_id}")
            violations.append(f"{cnt} players from {t_short} (max {MAX_PER_CLUB} allowed).")

    # Budget check
    total_cost = round(sum(pool.price_l[i] for i in all_idx), 1)
    bank = round(float(req.budget) - total_cost, 1)
    if total_cost > float(req.budget) + 1e-4:
        violations.append(
            f"Over budget by £{total_cost - req.budget:.1f}m (£{total_cost:.1f}m > £{req.budget:.1f}m limit)."
        )

    # Formation checks on Starting XI
    xi_counts = [0, 0, 0, 0]
    for i in starter_idx:
        xi_counts[pool.pos_l[i]] += 1
    if xi_counts[0] != 1 or pool.pos_l[bench_idx[0]] != 0:
        violations.append("Starting XI must have 1 GK and Bench slot 1 must be the second GK.")
    for p, label in ((1, "DEF"), (2, "MID"), (3, "FWD")):
        if xi_counts[p] < MIN_STARTERS[p]:
            violations.append(f"Starting XI has {xi_counts[p]} {label} (minimum {MIN_STARTERS[p]}).")

    starter_set = set(req.starters)
    cap_el = int(req.captain) if int(req.captain) in starter_set else int(req.starters[0])
    vc_el = int(req.vice_captain) if (int(req.vice_captain) in starter_set and int(req.vice_captain) != cap_el) else next(
        (int(e) for e in req.starters if int(e) != cap_el), cap_el
    )
    if int(req.captain) not in starter_set:
        violations.append("Captain must be in the Starting XI.")
    if int(req.vice_captain) not in starter_set or int(req.vice_captain) == int(req.captain):
        violations.append("Vice-Captain must be a different player in the Starting XI.")

    if req.enforce_constraints and violations:
        raise HTTPException(
            status_code=422,
            detail="Cannot confirm squad — FPL rule violations: " + " ".join(violations),
        )

    suggested_idx = max(all_idx, key=lambda i: pool.value_l[i])
    suggested_row = pool.frame.iloc[suggested_idx]
    suggested_el = int(suggested_row["element"])

    def _build_card(i: int, role: str) -> dict[str, Any]:
        row = pool.frame.iloc[i]
        el_id = int(row["element"])
        is_cap = el_id == cap_el and role == "starter"
        is_vc = el_id == vc_el and role == "starter"
        mult = (3 if req.active_chip == "3xc" else 2) if is_cap else (1 if role == "starter" or req.active_chip == "bboost" else 0)
        return _decorate_card(
            {
                "element": el_id,
                "name": str(row["name"]),
                "position": str(row["position"]),
                "team_id": int(row["team_id"]),
                "team_short": str(row.get("team_short", "")),
                "price": float(row["price"]),
                "xp_base": float(pool.xp_base[i]),
                "p_defcon": float(pool.p_defcon[i]),
                "xp": float(pool.value[i]),
                "role": role,
                "is_captain": is_cap,
                "is_vice_captain": is_vc,
                "is_suggested_captain": el_id == suggested_el,
                "multiplier": mult,
            },
            pool,
        )

    starter_order = sorted(starter_idx, key=lambda i: (pool.pos_l[i], -pool.value_l[i]))
    starter_cards = [_build_card(i, "starter") for i in starter_order]
    bench_cards = [_build_card(i, f"bench{j}") for j, i in enumerate(bench_idx)]

    starters_xp = sum(float(c["xp"]) * int(c["multiplier"]) for c in starter_cards)
    bench_xp = sum(float(c["xp"]) for c in bench_cards)
    projected_points = starters_xp + (bench_xp if req.active_chip == "bboost" else 0.0)
    cap_val = float(pool.value_l[pool.index_of(cap_el)])
    fitness = sum(pool.value_l[i] for i in starter_idx) + cap_val + BENCH_WEIGHT * sum(pool.value_l[i] for i in bench_idx)
    gw_rating_pct = _gw_rating_pct(fitness, snap.optimal_fitness)
    formation = f"{xi_counts[1]}-{xi_counts[2]}-{xi_counts[3]}"

    hit_cost = max(0, int(req.n_transfers) - int(req.free_transfers)) * 4
    net_projected_points = projected_points - hit_cost
    cap_card = next((c for c in starter_cards if c["is_captain"]), starter_cards[0])

    suggested_cap_obj = {
        "element": suggested_el,
        "name": str(suggested_row["name"]),
        "position": str(suggested_row["position"]),
        "team_short": str(suggested_row.get("team_short", "")),
        "xp": round(float(pool.value_l[suggested_idx]), 2),
        "current_captain_name": str(cap_card["name"]),
        "current_captain_xp": round(float(cap_card["xp"]), 2),
        "delta_xp": round(float(pool.value_l[suggested_idx]) - float(cap_card["xp"]), 2),
    }

    return {
        "gw": req.gw,
        "is_valid": len(violations) == 0,
        "violations": violations,
        "hit_cost": hit_cost,
        "n_transfers": req.n_transfers,
        "free_transfers": req.free_transfers,
        "net_projected_points": round(net_projected_points, 2),
        "optimal_fitness": round(snap.optimal_fitness, 2),
        "suggested_captain": suggested_cap_obj,
        "lineup": {
            "starters": starter_cards,
            "bench": bench_cards,
            "fitness": round(fitness, 2),
            "projected_points": round(projected_points, 2),
            "gw_rating_pct": gw_rating_pct,
            "formation": formation,
            "cost": total_cost,
            "bank": bank,
            "active_chip": req.active_chip,
            "suggested_captain": suggested_cap_obj,
        },
    }


@router.get("/benchmarks")
async def get_benchmarks() -> dict[str, Any]:
    """Serve offline experiment metrics and optimizer convergence data."""
    bench_file = RESULTS_DIR / "benchmarks.json"
    if not bench_file.exists():
        raise HTTPException(
            status_code=404,
            detail="Offline benchmarks not generated yet. Run `python src/experiments.py --seed 2026`.",
        )
    data = json.loads(bench_file.read_text(encoding="utf-8"))
    snap = await service.get_pool_snapshot(horizon=1)
    data["gmm_players"] = [
        p for p in snap.players_table
        if p.get("status") != "u"
        and not p.get("low_sample", False)
        and p.get("archetype") not in (None, "Unclassified")
    ]
    return data
