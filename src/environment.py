"""Gameweek environment: player pools, transfer optimisation and season backtests.

* `build_player_pool` turns per-fixture predictions into a per-player `PlayerPool`
  over a horizon (sums fixtures: doubles count twice, blanks contribute 0) and applies
  an availability multiplier.
* `TransferOptimizer` finds the best k-transfer plans from a manager's current squad:
  k=1 exact enumeration, k=2 pruned enumeration (top-N per position), k>=3 simulated
  annealing restricted to at most k changes. Plans are scored net of -4 hits per
  transfer beyond the free-transfer allowance.
* `SeasonBacktester` replays a historical season: an agent builds the GW1 squad, then
  each gameweek a 1-free-transfer optimiser (using only out-of-sample predictions made
  before that gameweek) updates it, and realised FPL points are scored with captaincy
  and auto-substitutions.
"""

from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd

from src.agents import AGENTS, SimulatedAnnealingAgent
from src.squad import (
    DEFAULT_BUDGET, NEG_INF, PlayerPool, SquadEvaluator, SquadState, score_actual,
)

logger = logging.getLogger(__name__)

HIT_COST: Final[float] = 4.0
MAX_FREE_TRANSFERS: Final[int] = 5


# ======================================================================================
# Pool construction
# ======================================================================================
def build_player_pool(
    fixture_preds: pd.DataFrame,
    players: pd.DataFrame,
    xp_col: str = "xp_base",
    defcon_col: str = "p_defcon",
    availability_col: str | None = "availability",
) -> PlayerPool:
    """Aggregate per-fixture predictions to a per-player pool.

    Args:
        fixture_preds: one row per (element, fixture) in the horizon, with ``xp_col`` and
            ``defcon_col``.
        players: one row per selectable player with ``element, name, position, team_id,
            price`` (+ optional ``availability`` and presentation columns). Players with
            no fixture in the horizon get xP 0.
    """
    agg = fixture_preds.groupby("element").agg(
        xp_base=(xp_col, "sum"), p_defcon=(defcon_col, "sum"), n_fixtures=(xp_col, "size")
    )
    pool = players.drop(columns=[c for c in ("xp_base", "p_defcon", "n_fixtures") if c in players]).merge(
        agg, left_on="element", right_index=True, how="left"
    )
    pool[["xp_base", "p_defcon", "n_fixtures"]] = pool[["xp_base", "p_defcon", "n_fixtures"]].fillna(0.0)
    if availability_col and availability_col in pool:
        a = pool[availability_col].fillna(1.0)
        pool["xp_base"] *= a
        pool["p_defcon"] *= a
    return PlayerPool(pool)


# ======================================================================================
# Transfer optimisation
# ======================================================================================
@dataclass
class TransferPlan:
    """A concrete set of transfers and its evaluation."""

    outs: list[int]  # pool indices
    ins: list[int]
    fitness: float
    gross_gain: float
    hits: int
    net_gain: float
    bank: float

    @property
    def n_transfers(self) -> int:
        return len(self.outs)


@dataclass
class TransferResult:
    """All plans found plus the baseline (no transfer) fitness."""

    base_fitness: float
    free_transfers: int
    plans: list[TransferPlan] = field(default_factory=list)

    def best(self, allow_hits: bool = False) -> TransferPlan | None:
        """Best plan by net gain (restricted to free transfers unless ``allow_hits``)."""
        cands = [p for p in self.plans if allow_hits or p.hits == 0]
        return max(cands, key=lambda p: p.net_gain, default=None)


class TransferOptimizer:
    """Finds the best k-transfer plans from an origin squad.

    The budget is the origin squad's value plus bank, so the origin is feasible.
    """

    def __init__(
        self,
        pool: PlayerPool,
        origin: SquadState,
        bank: float,
        free_transfers: int = 1,
        top_n_per_position: int = 12,
        seed: int = 2026,
        sa_iterations: int = 1_500,
        sa_restarts: int = 2,
        excluded: set[int] | None = None,
    ) -> None:
        if not 0 <= free_transfers <= MAX_FREE_TRANSFERS:
            raise ValueError(f"free_transfers must be in [0, {MAX_FREE_TRANSFERS}]")
        self.pool = pool
        self.origin = origin
        budget = float(pool.price[list(origin.players)].sum()) + float(bank)
        self.evaluator = SquadEvaluator(pool, budget=budget)
        self.free_transfers = free_transfers
        self.top_n = top_n_per_position
        self.seed = seed
        self.sa_iterations = sa_iterations
        self.sa_restarts = sa_restarts
        self.excluded = set(excluded or ())
        self.base_fitness = self.evaluator.fitness(origin)
        self._cache: dict[tuple[int, ...], float] = {origin.players: self.base_fitness}

    # ------------------------------------------------------------------ helpers
    def _fit(self, state: SquadState) -> float:
        f = self._cache.get(state.players)
        if f is None:
            f = self.evaluator.fitness(state)
            self._cache[state.players] = f
        return f

    def _plan(self, state: SquadState) -> TransferPlan:
        outs = sorted(set(self.origin.players) - set(state.players))
        ins = sorted(set(state.players) - set(self.origin.players))
        # Pair outs/ins by position for readable "out -> in" cards.
        ins_sorted: list[int] = []
        remaining = list(ins)
        for o in outs:
            match = next(i for i in remaining if self.pool.pos[i] == self.pool.pos[o])
            remaining.remove(match)
            ins_sorted.append(match)
        f = self._fit(state)
        hits = max(0, len(outs) - self.free_transfers)
        gross = f - self.base_fitness
        return TransferPlan(outs, ins_sorted, f, gross, hits, gross - HIT_COST * hits,
                            self.evaluator.bank(state))

    def _candidates(self, pos: int) -> np.ndarray:
        """Top-N non-squad players at ``pos`` by value, plus the best value-per-price."""
        idx = self.pool.indices_for_position(pos)
        idx = idx[~np.isin(idx, self.origin.players)]
        if self.excluded:
            idx = idx[~np.isin(idx, list(self.excluded))]
        by_val = idx[np.argsort(-self.pool.value[idx])][: self.top_n]
        ratio = self.pool.value[idx] / np.maximum(self.pool.price[idx], 0.1)
        by_ratio = idx[np.argsort(-ratio)][: max(5, self.top_n // 4)]
        return np.unique(np.concatenate([by_val, by_ratio]))

    # ------------------------------------------------------------------ searches
    def _top_plans(self, scored: list[tuple[float, SquadState]], limit: int = 50) -> list[TransferPlan]:
        scored.sort(key=lambda x: -x[0])
        return [self._plan(s) for _, s in scored[:limit]]

    def search_one(self, limit: int = 50) -> list[TransferPlan]:
        """Exact enumeration of all feasible single transfers."""
        scored: list[tuple[float, SquadState]] = []
        bank = self.evaluator.bank(self.origin)
        price = self.pool.price_l
        for o in self.origin.players:
            cand = self.pool.indices_for_position(self.pool.pos_l[o])
            max_price = price[o] + bank + 1e-9
            for i in cand[self.pool.price[cand] <= max_price].tolist():
                if i in self.origin or i in self.excluded:
                    continue
                state = self.origin.replace(o, i)
                f = self._fit(state)
                if f > NEG_INF:
                    scored.append((f, state))
        return self._top_plans(scored, limit)

    def search_two(self, limit: int = 50) -> list[TransferPlan]:
        """Pruned enumeration of double transfers over top-N candidates per position."""
        cands = {p: self._candidates(p).tolist() for p in range(4)}
        price = self.pool.price_l
        bank = self.evaluator.bank(self.origin)
        scored: list[tuple[float, SquadState]] = []
        for o1, o2 in itertools.combinations(self.origin.players, 2):
            p1, p2 = self.pool.pos_l[o1], self.pool.pos_l[o2]
            freed = price[o1] + price[o2] + bank + 1e-9
            pairs = itertools.combinations(cands[p1], 2) if p1 == p2 else itertools.product(cands[p1], cands[p2])
            for i1, i2 in pairs:
                if price[i1] + price[i2] > freed:
                    continue
                state = self.origin.replace_many([o1, o2], [i1, i2])
                f = self._fit(state)
                if f > NEG_INF:
                    scored.append((f, state))
        return self._top_plans(scored, limit)

    def search_k(self, k: int) -> list[TransferPlan]:
        """SA restricted to at most ``k`` changes from the origin (several restarts)."""
        plans: dict[tuple[int, ...], TransferPlan] = {}
        for r in range(self.sa_restarts):
            agent = SimulatedAnnealingAgent(
                self.evaluator, iterations=self.sa_iterations, t0=2.0, seed=self.seed + 97 * r + k,
                origin=self.origin, max_changes=k, excluded=self.excluded,
            )
            res = agent.select(self.origin)
            if res.state != self.origin and res.fitness > NEG_INF:
                plans[res.state.players] = self._plan(res.state)
        return sorted(plans.values(), key=lambda p: -p.fitness)

    def optimize(self, max_transfers: int | None = None, top_per_k: int = 5) -> TransferResult:
        """Search k = 1..max_transfers and return de-duplicated plans.

        ``max_transfers`` defaults to ``free_transfers + 2`` (the "show hits" range).
        """
        k_max = max_transfers if max_transfers is not None else self.free_transfers + 2
        k_max = max(1, k_max)
        result = TransferResult(self.base_fitness, self.free_transfers)
        seen: set[tuple[int, ...]] = set()
        for k in range(1, k_max + 1):
            if k == 1:
                found = self.search_one()
            elif k == 2:
                found = self.search_two()
            else:
                found = self.search_k(k)
            kept = 0
            for plan in found:
                key = tuple(sorted(plan.ins + plan.outs))
                if key in seen or plan.n_transfers != k:
                    continue
                seen.add(key)
                result.plans.append(plan)
                kept += 1
                if kept >= top_per_k:
                    break
        result.plans.sort(key=lambda p: -p.net_gain)
        return result


# ======================================================================================
# Season backtest (offline)
# ======================================================================================
@dataclass
class BacktestResult:
    """Per-gameweek realised points for one agent."""

    agent: str
    seed: int
    gw_points: pd.DataFrame  # columns: gw, points, cumulative, transfers, captain


class SeasonBacktester:
    """Replays a season using out-of-sample per-fixture predictions.

    ``predictions`` must contain, for every fixture row of the season: ``gw, element,
    name, position, team_id, value, minutes, total_points, minutes_roll3`` and the
    prediction columns. Each GW's pool uses only predictions for that GW, which were
    produced by models trained on strictly earlier gameweeks.
    """

    def __init__(
        self,
        predictions: pd.DataFrame,
        xp_col: str = "pred_hgb",
        defcon_col: str = "p_defcon",
        budget: float = DEFAULT_BUDGET,
        free_transfers_per_gw: int = 1,
    ) -> None:
        self.preds = predictions.copy()
        self.xp_col = xp_col
        self.defcon_col = defcon_col
        self.budget = budget
        self.ft = free_transfers_per_gw
        self.gws = sorted(self.preds["gw"].unique())
        self._prices = self._price_table()

    def _price_table(self) -> pd.DataFrame:
        """Price of every player at every GW (forward/back-filled across blanks)."""
        p = self.preds.groupby(["gw", "element"])["value"].last().unstack()
        return p.reindex(self.gws).ffill().bfill()

    def _players_at(self, gw: int) -> pd.DataFrame:
        prices = self._prices.loc[gw].dropna()
        info = self.preds.sort_values("gw").groupby("element")[["name", "position", "team_id"]].last()
        players = info.loc[prices.index].reset_index()
        players["price"] = prices.to_numpy()
        return players

    def pool_for(self, gw: int) -> PlayerPool:
        """Player pool for ``gw`` with the minutes-based availability proxy."""
        rows = self.preds[self.preds["gw"] == gw].copy()
        rows["xp_base"] = rows[self.xp_col]
        # Availability proxy: no minutes in any of the last 3 matches -> treated as out.
        avail = np.where(rows["minutes_roll3"].fillna(1.0) <= 0, 0.0, 1.0)
        rows["xp_base"] *= avail
        rows["p_defcon"] = rows[self.defcon_col] * avail
        return build_player_pool(rows, self._players_at(gw), availability_col=None)

    def _actuals(self, gw: int) -> tuple[dict[int, float], dict[int, float]]:
        g = self.preds[self.preds["gw"] == gw].groupby("element")[["total_points", "minutes"]].sum()
        return g["total_points"].to_dict(), g["minutes"].to_dict()

    def run(self, agent_key: str, seed: int = 2026, agent_kwargs: dict[str, object] | None = None) -> BacktestResult:
        """Build at GW1 with ``agent_key`` and make up to 1 free transfer every GW after."""
        rows: list[dict[str, object]] = []
        elements: list[int] = []
        bank = 0.0
        cumulative = 0.0
        for t, gw in enumerate(self.gws):
            pool = self.pool_for(gw)
            n_transfers = 0
            if t == 0:
                ev = SquadEvaluator(pool, budget=self.budget)
                agent = AGENTS[agent_key](ev, seed=seed, **(agent_kwargs or {}))
                state = agent.select().state
                bank = ev.bank(state)
            else:
                state = SquadState.of(pool.indices_of(elements))
                opt = TransferOptimizer(pool, state, bank=bank, free_transfers=self.ft)
                best = TransferResult(opt.base_fitness, self.ft, opt.search_one(limit=1)).best()
                if best is not None and best.net_gain > 1e-9:
                    state = state.replace(best.outs[0], best.ins[0])
                    bank = best.bank
                    n_transfers = 1
                else:
                    bank = opt.evaluator.bank(state)
            elements = [int(pool.element[i]) for i in state.players]
            lineup = SquadEvaluator(pool, budget=np.inf).solve_lineup(state)
            pts, mins = self._actuals(gw)
            gw_pts = score_actual(pool, state, lineup, pts, mins)
            cumulative += gw_pts
            rows.append({"gw": gw, "points": gw_pts, "cumulative": cumulative, "transfers": n_transfers,
                         "captain": str(pool.frame.iloc[lineup.captain]["name"]),
                         "expected": lineup.fitness})
        name = AGENTS[agent_key].name
        return BacktestResult(name, seed, pd.DataFrame(rows))
