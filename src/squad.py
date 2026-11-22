"""Squad representation, hard-constraint checks, formation solver and fitness.

The optimisation state is a 15-player squad (2 GK, 5 DEF, 5 MID, 3 FWD) drawn from a
`PlayerPool`. `SquadEvaluator` implements the DefCon-aware fitness

    F(S) = sum_{p in XI} (xP_base(p) + 2 P(DefCon_p))  +  xP(captain)  +  0.1 * sum_{b in bench} xP(b)

where ``xP(p) = xP_base(p) + 2 P(DefCon_p)`` is a player's full expected points, and
returns ``-inf`` for any squad violating a hard constraint.

The starting-XI picker is exact: one GK (best of two), then the mandatory minimum
3 DEF / 2 MID / 1 FWD by value, then the best 4 remaining outfielders. Because the
formation constraints are lower bounds on nested position groups, this greedy fill is
provably optimal.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final, Iterable, Sequence

import numpy as np
import pandas as pd

POS_INDEX: Final[dict[str, int]] = {"GK": 0, "DEF": 1, "MID": 2, "FWD": 3}
POS_NAMES: Final[tuple[str, ...]] = ("GK", "DEF", "MID", "FWD")
SQUAD_QUOTA: Final[tuple[int, ...]] = (2, 5, 5, 3)
SQUAD_SIZE: Final[int] = 15
MIN_STARTERS: Final[tuple[int, ...]] = (1, 3, 2, 1)
MAX_PER_CLUB: Final[int] = 3
DEFAULT_BUDGET: Final[float] = 100.0
BENCH_WEIGHT: Final[float] = 0.1
DEFCON_POINTS: Final[float] = 2.0
NEG_INF: Final[float] = float("-inf")
_EPS: Final[float] = 1e-9


class PlayerPool:
    """Immutable, array-backed pool of selectable players.

    Required columns: ``element``, ``name``, ``position``, ``team_id``, ``price``,
    ``xp_base``, ``p_defcon``. Optional: ``team_short``, anything else is kept in
    `frame` for presentation.
    """

    REQUIRED: Final[tuple[str, ...]] = ("element", "name", "position", "team_id", "price", "xp_base", "p_defcon")

    def __init__(self, frame: pd.DataFrame) -> None:
        missing = [c for c in self.REQUIRED if c not in frame]
        if missing:
            raise ValueError(f"PlayerPool missing columns: {missing}")
        df = frame.reset_index(drop=True).copy()
        df["position"] = df["position"].astype(str)
        self._frame = df
        self.element: np.ndarray = df["element"].to_numpy(dtype=np.int64)
        self.pos: np.ndarray = df["position"].map(POS_INDEX).to_numpy(dtype=np.int8)
        self.team: np.ndarray = df["team_id"].to_numpy(dtype=np.int64)
        self.price: np.ndarray = df["price"].to_numpy(dtype=float)
        self.xp_base: np.ndarray = df["xp_base"].fillna(0.0).to_numpy(dtype=float)
        self.p_defcon: np.ndarray = df["p_defcon"].fillna(0.0).to_numpy(dtype=float)
        #: Starter contribution per player: xP_base + 2 * P(DefCon hit).
        self.value: np.ndarray = self.xp_base + DEFCON_POINTS * self.p_defcon
        self._by_pos: tuple[np.ndarray, ...] = tuple(np.flatnonzero(self.pos == p) for p in range(4))
        self._index_of: dict[int, int] = {int(e): i for i, e in enumerate(self.element)}
        # Plain-Python mirrors: for 15-element squads, list indexing beats numpy overhead.
        self.pos_l: list[int] = self.pos.tolist()
        self.team_l: list[int] = self.team.tolist()
        self.price_l: list[float] = self.price.tolist()
        self.value_l: list[float] = self.value.tolist()
        self.n_teams: int = int(self.team.max()) + 1 if len(self.team) else 1

    def __len__(self) -> int:
        return len(self.element)

    @property
    def frame(self) -> pd.DataFrame:
        """Underlying DataFrame (row ``i`` corresponds to pool index ``i``)."""
        return self._frame

    def indices_for_position(self, pos: int) -> np.ndarray:
        """Pool indices of all players at position ``pos`` (0=GK..3=FWD)."""
        return self._by_pos[pos]

    def index_of(self, element: int) -> int:
        """Pool index for an FPL element id."""
        return self._index_of[int(element)]

    def indices_of(self, elements: Iterable[int]) -> list[int]:
        """Pool indices for several FPL element ids."""
        return [self.index_of(e) for e in elements]


@dataclass(frozen=True)
class SquadState:
    """A candidate squad: sorted tuple of 15 pool indices (hashable, immutable)."""

    players: tuple[int, ...]

    @staticmethod
    def of(indices: Iterable[int]) -> "SquadState":
        """Build a canonical (sorted) state."""
        return SquadState(tuple(sorted(indices)))

    def replace(self, out_idx: int, in_idx: int) -> "SquadState":
        """Return a new state with ``out_idx`` swapped for ``in_idx``."""
        lst = [in_idx if p == out_idx else p for p in self.players]
        lst.sort()
        return SquadState(tuple(lst))

    def replace_many(self, outs: Sequence[int], ins: Sequence[int]) -> "SquadState":
        """Return a new state applying several swaps at once."""
        if len(outs) == 2:
            o0, o1 = outs[0], outs[1]
            i0, i1 = ins[0], ins[1]
            lst = [i0 if p == o0 else (i1 if p == o1 else p) for p in self.players]
            lst.sort()
            return SquadState(tuple(lst))
        mapping = dict(zip(outs, ins))
        return SquadState(tuple(sorted(mapping.get(p, p) for p in self.players)))

    def __contains__(self, idx: object) -> bool:
        return idx in self.players

    def __len__(self) -> int:
        return len(self.players)


@dataclass(frozen=True)
class Lineup:
    """Solved starting XI, bench order and armband for a squad."""

    starters: tuple[int, ...]
    bench: tuple[int, ...]  # [bench GK, sub1, sub2, sub3]
    captain: int
    vice_captain: int
    formation: str
    fitness: float


@dataclass
class ConstraintReport:
    """Result of a hard-constraint check."""

    valid: bool
    violations: list[str] = field(default_factory=list)


class SquadEvaluator:
    """Checks hard constraints, solves the starting XI and scores squads."""

    def __init__(self, pool: PlayerPool, budget: float = DEFAULT_BUDGET,
                 max_per_club: int = MAX_PER_CLUB, bench_weight: float = BENCH_WEIGHT) -> None:
        self.pool = pool
        self.budget = float(budget)
        self.max_per_club = max_per_club
        self.bench_weight = bench_weight
        self.evaluations: int = 0

    # ------------------------------------------------------------------ constraints
    def check(self, state: SquadState) -> ConstraintReport:
        """Full constraint report with human-readable violations."""
        v: list[str] = []
        idx = np.asarray(state.players, dtype=np.int64)
        if len(idx) != SQUAD_SIZE:
            v.append(f"squad has {len(idx)} players (need {SQUAD_SIZE})")
        if len(set(state.players)) != len(idx):
            v.append("duplicate players")
        if len(idx) and (idx.min() < 0 or idx.max() >= len(self.pool)):
            return ConstraintReport(False, v + ["index out of range"])
        counts = np.bincount(self.pool.pos[idx], minlength=4)
        for p, (have, need) in enumerate(zip(counts, SQUAD_QUOTA)):
            if have != need:
                v.append(f"{POS_NAMES[p]}: {have} (need {need})")
        cost = float(self.pool.price[idx].sum())
        if cost > self.budget + _EPS:
            v.append(f"cost {cost:.1f} exceeds budget {self.budget:.1f}")
        clubs, club_counts = np.unique(self.pool.team[idx], return_counts=True)
        for c, n in zip(clubs, club_counts):
            if n > self.max_per_club:
                v.append(f"{n} players from club {c} (max {self.max_per_club})")
        return ConstraintReport(not v, v)

    def is_valid(self, state: SquadState) -> bool:
        """Fast boolean hard-constraint check (pure Python over 15 players)."""
        players = state.players
        if len(players) != SQUAD_SIZE or len(set(players)) != SQUAD_SIZE:
            return False
        pool = self.pool
        price, pos, team = pool.price_l, pool.pos_l, pool.team_l
        cost = 0.0
        counts = [0, 0, 0, 0]
        clubs: dict[int, int] = {}
        for p in players:
            cost += price[p]
            counts[pos[p]] += 1
            t = team[p]
            c = clubs.get(t, 0) + 1
            if c > self.max_per_club:
                return False
            clubs[t] = c
        return cost <= self.budget + _EPS and tuple(counts) == SQUAD_QUOTA

    def cost(self, state: SquadState) -> float:
        """Total squad price."""
        return float(sum(self.pool.price_l[p] for p in state.players))

    def bank(self, state: SquadState) -> float:
        """Remaining budget."""
        return self.budget - self.cost(state)

    # ------------------------------------------------------------------ lineup
    def _lineup_core(self, players: tuple[int, ...]) -> tuple[list[int], list[int], float]:
        """Exact XI selection: returns (starters, bench, fitness) with captain bonus."""
        pool = self.pool
        val, pos = pool.value_l, pool.pos_l
        groups: list[list[int]] = [[], [], [], []]
        for p in players:
            groups[pos[p]].append(p)
        for g in groups:
            g.sort(key=lambda i: -val[i])
        starters = [groups[0][0]]
        rest: list[int] = []
        for p in (1, 2, 3):
            k = MIN_STARTERS[p]
            starters.extend(groups[p][:k])
            rest.extend(groups[p][k:])
        rest.sort(key=lambda i: -val[i])
        starters.extend(rest[:4])
        bench = groups[0][1:2] + rest[4:]
        s_val = sum(val[i] for i in starters)
        cap = max(val[i] for i in starters)
        fitness = s_val + cap + self.bench_weight * sum(val[i] for i in bench)
        return starters, bench, fitness

    def solve_lineup(self, state: SquadState) -> Lineup:
        """Exact best XI + captaincy for a (position-valid) squad."""
        pool = self.pool
        starters, bench, fitness = self._lineup_core(state.players)
        ranked = sorted(starters, key=lambda i: -pool.value_l[i])
        captain, vice = ranked[0], ranked[1]
        n = [0, 0, 0, 0]
        for i in starters:
            n[pool.pos_l[i]] += 1
        formation = f"{n[1]}-{n[2]}-{n[3]}"
        return Lineup(tuple(starters), tuple(bench), captain, vice, formation, fitness)

    # ------------------------------------------------------------------ fitness
    def fitness(self, state: SquadState) -> float:
        """DefCon-aware fitness, ``-inf`` if any hard constraint is violated."""
        self.evaluations += 1
        if not self.is_valid(state):
            return NEG_INF
        return self._lineup_core(state.players)[2]

    def describe(self, state: SquadState) -> dict[str, object]:
        """JSON-friendly description of a squad and its lineup (for API/reporting)."""
        lineup = self.solve_lineup(state)
        f = self.pool.frame
        def card(i: int, role: str) -> dict[str, object]:
            row = f.iloc[i]
            return {
                "element": int(row["element"]), "name": str(row["name"]), "position": str(row["position"]),
                "team_id": int(row["team_id"]), "team_short": str(row.get("team_short", "")),
                "price": float(row["price"]), "xp_base": float(self.pool.xp_base[i]),
                "p_defcon": float(self.pool.p_defcon[i]), "xp": float(self.pool.value[i]),
                "role": role, "is_captain": i == lineup.captain, "is_vice_captain": i == lineup.vice_captain,
            }
        return {
            "formation": lineup.formation,
            "fitness": lineup.fitness,
            "cost": self.cost(state),
            "bank": self.bank(state),
            "starters": [card(i, "starter") for i in lineup.starters],
            "bench": [card(i, f"bench{j}") for j, i in enumerate(lineup.bench)],
        }


def score_actual(
    pool: PlayerPool, state: SquadState, lineup: Lineup, actual_points: dict[int, float],
    minutes: dict[int, float],
) -> float:
    """Realised FPL points for a lineup with captaincy and simplified auto-subs.

    Auto-subs: a starter with 0 minutes is replaced by the first bench player (in order)
    who played and keeps the formation valid; GK only swaps with the bench GK. If the
    captain did not play, the vice-captain receives the armband.
    """
    el = pool.element
    played = lambda i: minutes.get(int(el[i]), 0.0) > 0  # noqa: E731
    pts = lambda i: actual_points.get(int(el[i]), 0.0)  # noqa: E731
    xi = list(lineup.starters)
    bench = list(lineup.bench)
    gk_bench = [b for b in bench if pool.pos[b] == 0]
    out_bench = [b for b in bench if pool.pos[b] != 0]
    for s in list(xi):
        if played(s):
            continue
        if pool.pos[s] == 0:
            if gk_bench and played(gk_bench[0]):
                xi[xi.index(s)] = gk_bench.pop(0)
            continue
        for b in out_bench:
            if not played(b):
                continue
            trial = [b if x == s else x for x in xi]
            counts = np.bincount(pool.pos[trial], minlength=4)
            if all(counts[p] >= MIN_STARTERS[p] for p in range(1, 4)):
                xi = trial
                out_bench.remove(b)
                break
    total = sum(pts(i) for i in xi)
    if played(lineup.captain) and lineup.captain in xi:
        total += pts(lineup.captain)
    elif played(lineup.vice_captain) and lineup.vice_captain in xi:
        total += pts(lineup.vice_captain)
    return float(total)
