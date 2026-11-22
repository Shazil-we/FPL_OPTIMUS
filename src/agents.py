"""Local-search squad selector agents, implemented from scratch.

Class hierarchy (OOP: encapsulation, inheritance, method overriding)::

    BaseSelectorAgent (abstract)        - shared RNG, fitness cache, eval budget,
    |                                     random valid squads, feasible move generators
    +-- RandomSquadAgent                - uniform valid rosters, keep the best
    +-- GreedyValueAgent                - xP/price ratio constructive heuristic
    +-- HillClimbingAgent               - steepest ascent on a sampled neighbourhood
    +-- SimulatedAnnealingAgent         - geometric cooling, 1-swap/2-swap, Metropolis

Every agent overrides `_search` and returns a `SearchResult` with a per-iteration
convergence history. No external optimisation solvers are used.

Agents optionally accept an ``origin`` squad and ``max_changes``: any state differing
from the origin by more than ``max_changes`` players is never visited. This powers the
transfer optimiser (k-transfer search from the manager's current squad).
"""

from __future__ import annotations

import math
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Final

import numpy as np

from src.squad import NEG_INF, SQUAD_QUOTA, SQUAD_SIZE, PlayerPool, SquadEvaluator, SquadState

DEFAULT_EVAL_BUDGET: Final[int] = 5_000


@dataclass
class SearchResult:
    """Output of an agent run."""

    agent: str
    state: SquadState
    fitness: float
    evaluations: int
    runtime_s: float
    history: list[dict[str, float]] = field(default_factory=list)
    meta: dict[str, float | int | str] = field(default_factory=dict)

    def downsampled_history(self, max_points: int = 200) -> list[dict[str, float]]:
        """Evenly thinned history for transport to the frontend."""
        if len(self.history) <= max_points:
            return self.history
        step = math.ceil(len(self.history) / max_points)
        thinned = self.history[::step]
        if thinned[-1] is not self.history[-1]:
            thinned.append(self.history[-1])
        return thinned


class BaseSelectorAgent(ABC):
    """Abstract base agent: owns the evaluator, RNG, cache and move generators."""

    name: str = "Base"

    def __init__(
        self,
        evaluator: SquadEvaluator,
        seed: int = 2026,
        max_evals: int = DEFAULT_EVAL_BUDGET,
        origin: SquadState | None = None,
        max_changes: int | None = None,
        excluded: set[int] | None = None,
    ) -> None:
        self._evaluator = evaluator
        self._pool: PlayerPool = evaluator.pool
        self._rng = np.random.default_rng(seed)
        self._max_evals = int(max_evals)
        self._cache: dict[tuple[int, ...], float] = {}
        self._evals = 0
        self._origin = origin
        self._origin_set: frozenset[int] = frozenset(origin.players) if origin else frozenset()
        self._max_changes = max_changes
        #: Pool indices that may never be brought in (e.g. unavailable players).
        self._excluded: set[int] = set(excluded or ())

    # ------------------------------------------------------------------ public API
    def select(self, initial: SquadState | None = None) -> SearchResult:
        """Run the search and return the best squad found."""
        self._cache.clear()
        self._evals = 0
        t0 = time.perf_counter()
        result = self._search(initial)
        result.runtime_s = time.perf_counter() - t0
        result.evaluations = self._evals
        return result

    @abstractmethod
    def _search(self, initial: SquadState | None) -> SearchResult:
        """Agent-specific search procedure (overridden by every subclass)."""

    # ------------------------------------------------------------------ helpers
    @property
    def budget_exhausted(self) -> bool:
        """True once the fitness-evaluation budget is used up."""
        return self._evals >= self._max_evals

    def fitness(self, state: SquadState) -> float:
        """Cached fitness; every call counts against the evaluation budget."""
        self._evals += 1
        key = state.players
        val = self._cache.get(key)
        if val is None:
            val = self._evaluator.fitness(state)
            self._cache[key] = val
        return val

    def changes_from_origin(self, state: SquadState) -> int:
        """Number of players in ``state`` not in the origin squad."""
        if self._origin is None:
            return 0
        return sum(1 for p in state.players if p not in self._origin_set)

    def _within_change_limit(self, state: SquadState) -> bool:
        return self._max_changes is None or self.changes_from_origin(state) <= self._max_changes

    def _club_counts(self, players: tuple[int, ...]) -> dict[int, int]:
        counts: dict[int, int] = {}
        for p in players:
            t = int(self._pool.team[p])
            counts[t] = counts.get(t, 0) + 1
        return counts

    def random_valid_squad(self, max_tries: int = 2_000) -> SquadState:
        """Sample a valid squad by randomised sequential construction.

        Slots are filled in random order; at each step only candidates that keep the
        remaining slots affordable (using the cheapest available prices) are allowed.
        All filters are vectorised boolean masks over the pool.
        """
        pool, ev = self._pool, self._evaluator
        cheapest = [np.sort(pool.price[pool.indices_for_position(p)]) for p in range(4)]
        base_ok = np.ones(len(pool), dtype=bool)
        if self._excluded:
            base_ok[list(self._excluded)] = False
        for _ in range(max_tries):
            slots = [p for p, q in enumerate(SQUAD_QUOTA) for _ in range(q)]
            self._rng.shuffle(slots)
            remaining = list(SQUAD_QUOTA)
            ok_mask = base_ok.copy()
            club_count = np.zeros(pool.n_teams, dtype=np.int64)
            chosen: list[int] = []
            spent = 0.0
            for pos in slots:
                remaining[pos] -= 1
                reserve = sum(float(cheapest[p][: remaining[p]].sum()) for p in range(4))
                cand = pool.indices_for_position(pos)
                m = ok_mask[cand] & (pool.price[cand] <= ev.budget - spent - reserve + 1e-9)
                m &= club_count[pool.team[cand]] < ev.max_per_club
                cand = cand[m]
                if len(cand) == 0:
                    break
                pick = int(cand[self._rng.integers(len(cand))])
                chosen.append(pick)
                ok_mask[pick] = False
                club_count[pool.team[pick]] += 1
                spent += pool.price_l[pick]
            if len(chosen) == SQUAD_SIZE:
                state = SquadState.of(chosen)
                if ev.is_valid(state):
                    return state
        raise RuntimeError("Could not sample a valid squad - budget too low?")

    def _club_array(self, players: tuple[int, ...]) -> np.ndarray:
        counts = np.zeros(self._pool.n_teams, dtype=np.int64)
        np.add.at(counts, self._pool.team[list(players)], 1)
        return counts

    def _feasible_replacements(self, state: SquadState, out_idx: int, extra_bank: float = 0.0) -> np.ndarray:
        """Same-position players that can replace ``out_idx`` without breaking constraints."""
        pool, ev = self._pool, self._evaluator
        cand = pool.indices_for_position(pool.pos_l[out_idx])
        bank = ev.budget - sum(pool.price_l[p] for p in state.players) + extra_bank
        mask = pool.price[cand] <= bank + pool.price_l[out_idx] + 1e-9
        mask &= ~np.isin(cand, state.players)
        if self._excluded:
            mask &= ~np.isin(cand, list(self._excluded))
        clubs = self._club_array(state.players)
        clubs[pool.team_l[out_idx]] -= 1
        mask &= clubs[pool.team[cand]] < ev.max_per_club
        return cand[mask]

    def _free_changes(self, state: SquadState) -> int | None:
        """Remaining changes allowed before hitting ``max_changes`` (None = unlimited)."""
        if self._max_changes is None or self._origin is None:
            return None
        return self._max_changes - self.changes_from_origin(state)

    def _out_choices(self, state: SquadState, need_new: bool) -> tuple[int, ...]:
        """Players that may leave; if at the change limit only previously-bought ones."""
        if not need_new:
            return state.players
        return tuple(p for p in state.players if p not in self._origin_set)

    def one_swap(self, state: SquadState) -> SquadState | None:
        """Random feasible position-preserving 1-swap neighbour.

        Under a change limit, once the limit is reached the outgoing player is drawn
        only from players not in the origin squad, so every proposal stays feasible.
        """
        free = self._free_changes(state)
        outs = self._out_choices(state, free is not None and free <= 0)
        if not outs:
            return None
        for _ in range(20):
            out_idx = outs[int(self._rng.integers(len(outs)))]
            cand = self._feasible_replacements(state, out_idx)
            if len(cand) == 0:
                continue
            nxt = state.replace(out_idx, int(cand[self._rng.integers(len(cand))]))
            if self._within_change_limit(nxt):
                return nxt
        return None

    def two_swap(self, state: SquadState) -> SquadState | None:
        """Simultaneous swap of two players at different positions (budget shifting).

        The first replacement is drawn from all same-position players affordable after
        freeing both outgoing prices (allowing an *upgrade*), and the second is chosen
        so that the combined move stays within budget (a *downgrade* if necessary).
        """
        pool, ev = self._pool, self._evaluator
        free = self._free_changes(state)
        outs_a = self._out_choices(state, free is not None and free <= 1)
        outs_b = self._out_choices(state, free is not None and free <= 0)
        if not outs_a or not outs_b:
            return None
        for _ in range(20):
            a = outs_a[int(self._rng.integers(len(outs_a)))]
            b = outs_b[int(self._rng.integers(len(outs_b)))]
            if a == b or pool.pos_l[a] == pool.pos_l[b]:
                continue
            partial = SquadState.of(p for p in state.players if p not in (a, b))
            bank = ev.budget - float(pool.price[list(partial.players)].sum())
            cheapest_b = float(pool.price[pool.indices_for_position(int(pool.pos[b]))].min())
            cand_a = pool.indices_for_position(int(pool.pos[a]))
            cand_a = cand_a[(pool.price[cand_a] <= bank - cheapest_b + 1e-9) & ~np.isin(cand_a, state.players)]
            if len(cand_a) == 0:
                continue
            in_a = int(self._rng.choice(cand_a))
            if in_a in self._excluded:
                continue
            mid = state.replace(a, in_a)
            if self._club_array(mid.players).max() > ev.max_per_club:
                continue
            cand_b = self._feasible_replacements(mid, b)
            if len(cand_b) == 0:
                continue
            nxt = mid.replace(b, int(self._rng.choice(cand_b)))
            if self._within_change_limit(nxt):
                return nxt
        return None


# ======================================================================================
class RandomSquadAgent(BaseSelectorAgent):
    """Baseline: sample valid squads uniformly, keep the best one seen."""

    name = "Random"

    def _search(self, initial: SquadState | None) -> SearchResult:
        best = initial or self.random_valid_squad()
        best_f = self.fitness(best)
        history = [{"iter": 0, "evals": self._evals, "current": best_f, "best": best_f}]
        it = 0
        while not self.budget_exhausted:
            it += 1
            cand = self.random_valid_squad()
            f = self.fitness(cand)
            if f > best_f:
                best, best_f = cand, f
            history.append({"iter": it, "evals": self._evals, "current": f, "best": best_f})
        return SearchResult(self.name, best, best_f, self._evals, 0.0, history)


# ======================================================================================
class GreedyValueAgent(BaseSelectorAgent):
    """Constructive baseline: pick players by descending xP/price ratio.

    A player is only accepted if, after buying him, the remaining open slots can still
    be filled with the cheapest players available (budget look-ahead) and the club cap
    holds. Single-shot: uses one fitness evaluation.
    """

    name = "Greedy"

    def _search(self, initial: SquadState | None) -> SearchResult:
        pool, ev = self._pool, self._evaluator
        ratio = np.where(pool.price > 0, pool.value / pool.price, -np.inf)
        order = np.argsort(-ratio, kind="stable")
        need = list(SQUAD_QUOTA)
        chosen: list[int] = []
        clubs: dict[int, int] = {}
        spent = 0.0
        cheapest = [np.sort(pool.price[pool.indices_for_position(p)]) for p in range(4)]

        def reserve(need_after: list[int]) -> float:
            return float(sum(cheapest[p][: need_after[p]].sum() for p in range(4)))

        for idx in order:
            idx = int(idx)
            p = int(pool.pos[idx])
            if need[p] == 0 or idx in self._excluded:
                continue
            team = int(pool.team[idx])
            if clubs.get(team, 0) >= ev.max_per_club:
                continue
            after = need.copy()
            after[p] -= 1
            if spent + float(pool.price[idx]) + reserve(after) > ev.budget + 1e-9:
                continue
            chosen.append(idx)
            need = after
            clubs[team] = clubs.get(team, 0) + 1
            spent += float(pool.price[idx])
            if sum(need) == 0:
                break
        state = SquadState.of(chosen)
        f = self.fitness(state)
        return SearchResult(self.name, state, f, self._evals, 0.0,
                            [{"iter": 0, "evals": self._evals, "current": f, "best": f}])


# ======================================================================================
class HillClimbingAgent(BaseSelectorAgent):
    """Steepest-ascent hill climbing over a sampled 1-swap neighbourhood.

    Each step samples ``neighbourhood_size`` feasible neighbours and moves to the best
    one only if it strictly improves fitness. At a local optimum the agent either stops
    (``restarts=False``, exposing the trap) or restarts from a new random valid squad.
    """

    name = "HillClimbing"

    def __init__(self, evaluator: SquadEvaluator, neighbourhood_size: int = 50,
                 restarts: bool = True, **kwargs: object) -> None:
        super().__init__(evaluator, **kwargs)  # type: ignore[arg-type]
        self._k = neighbourhood_size
        self._restarts = restarts
        if not restarts:
            self.name = "HillClimbing (no restart)"

    def _search(self, initial: SquadState | None) -> SearchResult:
        current = initial or self.random_valid_squad()
        cur_f = self.fitness(current)
        best, best_f = current, cur_f
        history = [{"iter": 0, "evals": self._evals, "current": cur_f, "best": best_f}]
        it, n_restarts, local_optima = 0, 0, []
        while not self.budget_exhausted:
            it += 1
            top, top_f = None, NEG_INF
            for _ in range(self._k):
                if self.budget_exhausted:
                    break
                nb = self.one_swap(current)
                if nb is None:
                    continue
                f = self.fitness(nb)
                if f > top_f:
                    top, top_f = nb, f
            if top is not None and top_f > cur_f + 1e-12:
                current, cur_f = top, top_f
            else:
                local_optima.append(cur_f)
                if not self._restarts or self._origin is not None:
                    history.append({"iter": it, "evals": self._evals, "current": cur_f, "best": best_f})
                    break
                n_restarts += 1
                current = self.random_valid_squad()
                cur_f = self.fitness(current)
            if cur_f > best_f:
                best, best_f = current, cur_f
            history.append({"iter": it, "evals": self._evals, "current": cur_f, "best": best_f})
        return SearchResult(self.name, best, best_f, self._evals, 0.0, history,
                            meta={"restarts": n_restarts, "local_optima": len(local_optima),
                                  "mean_local_optimum": float(np.mean(local_optima)) if local_optima else best_f})


# ======================================================================================
class SimulatedAnnealingAgent(BaseSelectorAgent):
    """Simulated annealing with geometric cooling and mixed 1-/2-swap moves.

    * Temperature: ``T_k = max(T0 * alpha**k, T_min)`` (``T0=10, alpha=0.995, T_min=1e-4``).
    * Moves: 80% position-preserving 1-swap, 20% 2-swap across two positions.
    * Acceptance (Metropolis): always accept improvements, otherwise with
      probability ``exp(dE / T)`` where ``dE = F(S') - F(S) < 0``.
    * Runs for ``iterations`` proposals (default 5,000) or until the evaluation budget.
    """

    name = "SimulatedAnnealing"

    def __init__(self, evaluator: SquadEvaluator, t0: float = 10.0, alpha: float = 0.995,
                 t_min: float = 1e-4, iterations: int = 5_000, p_two_swap: float = 0.2,
                 **kwargs: object) -> None:
        kwargs.setdefault("max_evals", iterations + 1)
        super().__init__(evaluator, **kwargs)  # type: ignore[arg-type]
        self.t0, self.alpha, self.t_min = t0, alpha, t_min
        self.iterations = iterations
        self.p_two_swap = p_two_swap

    def temperature(self, k: int) -> float:
        """Geometric cooling schedule."""
        return max(self.t0 * self.alpha ** k, self.t_min)

    def _search(self, initial: SquadState | None) -> SearchResult:
        current = initial or self.random_valid_squad()
        cur_f = self.fitness(current)
        best, best_f = current, cur_f
        history = [{"iter": 0, "evals": self._evals, "temperature": self.t0, "current": cur_f, "best": best_f}]
        accepted = worse_accepted = 0
        for k in range(1, self.iterations + 1):
            if self.budget_exhausted:
                break
            T = self.temperature(k)
            two = self._rng.random() < self.p_two_swap
            nb = self.two_swap(current) if two else None
            if nb is None:
                nb = self.one_swap(current)
            if nb is None:
                continue
            f = self.fitness(nb)
            delta = f - cur_f
            if delta >= 0 or (math.isfinite(f) and self._rng.random() < math.exp(delta / T)):
                if delta < 0:
                    worse_accepted += 1
                current, cur_f = nb, f
                accepted += 1
                if cur_f > best_f:
                    best, best_f = current, cur_f
            history.append({"iter": k, "evals": self._evals, "temperature": T, "current": cur_f, "best": best_f})
        return SearchResult(self.name, best, best_f, self._evals, 0.0, history,
                            meta={"accepted": accepted, "worse_accepted": worse_accepted})


AGENTS: Final[dict[str, type[BaseSelectorAgent]]] = {
    "sa": SimulatedAnnealingAgent,
    "hc": HillClimbingAgent,
    "greedy": GreedyValueAgent,
    "random": RandomSquadAgent,
}
