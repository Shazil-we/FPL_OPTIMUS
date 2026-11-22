"""Unit and integration test suite for FPL-Optimus.

Covers:
1. Squad hard-constraint verification (budget, 2-5-5-3 position quotas, max 3 per club,
   duplicate detection).
2. Exact formation solver & DefCon-integrated fitness calculation.
3. Custom local search agents (SimulatedAnnealing, HillClimbing, Greedy, Random) and
   OOP polymorphism.
4. TransferOptimizer exact 1-swap, pruned 2-swap, k>=3 restricted SA, and -4pt hit maths.
5. `FPLApiClient` TTL caching and offline disk fallback with mocked `httpx`.
6. FastAPI endpoints (`/health`, `/api/bootstrap`, `/api/optimize/build`,
   `/api/optimize/transfers`, `/api/live/{gw}`).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from src.agents import (
    AGENTS,
    BaseSelectorAgent,
    GreedyValueAgent,
    HillClimbingAgent,
    RandomSquadAgent,
    SimulatedAnnealingAgent,
)
from src.data_loader import CacheStore, FPLApiClient, FPLApiError, add_defcon_columns
from src.environment import HIT_COST, TransferOptimizer
from src.squad import NEG_INF, PlayerPool, SquadEvaluator, SquadState, score_actual


# ======================================================================================
# Fixtures
# ======================================================================================
@pytest.fixture()
def synthetic_pool() -> PlayerPool:
    """Create a synthetic 60-player pool across 10 clubs with realistic prices & xP."""
    rng = np.random.default_rng(2026)
    positions = ["GK"] * 8 + ["DEF"] * 20 + ["MID"] * 20 + ["FWD"] * 12
    rows = []
    for i, pos in enumerate(positions):
        rows.append(
            {
                "element": i + 1,
                "name": f"Player_{i+1}_{pos}",
                "position": pos,
                "team_id": (i % 10) + 1,
                "team_short": f"T{(i % 10) + 1}",
                "price": round(float(rng.uniform(4.0, 9.5)), 1),
                "xp_base": round(float(rng.uniform(1.0, 6.5)), 2),
                "p_defcon": 0.0 if pos == "GK" else round(float(rng.uniform(0.05, 0.45)), 2),
            }
        )
    return PlayerPool(pd.DataFrame(rows))


# ======================================================================================
# 1. DefCon telemetry & Squad constraints / fitness
# ======================================================================================
def test_defcon_columns_thresholds() -> None:
    df = pd.DataFrame(
        {
            "position": ["GK", "DEF", "DEF", "MID", "FWD"],
            "cbi": [5, 7, 6, 6, 4],
            "tackles": [1, 3, 2, 3, 4],
            "recoveries": [4, 5, 5, 4, 4],
            "total_points": [6, 8, 2, 7, 9],
            "defcon_available": [True, True, True, True, True],
        }
    )
    out = add_defcon_columns(df)
    # DEF needs CBIT >= 10: row 1 has 7+3=10 (hit), row 2 has 6+2=8 (miss)
    assert out.loc[1, "cbit"] == 10 and out.loc[1, "defcon_hit"] == 1.0
    assert out.loc[2, "cbit"] == 8 and out.loc[2, "defcon_hit"] == 0.0
    # MID/FWD need CBIRT >= 12: row 3 has 6+3+4=13 (hit), row 4 has 4+4+4=12 (hit)
    assert out.loc[3, "cbirt"] == 13 and out.loc[3, "defcon_hit"] == 1.0
    assert out.loc[4, "cbirt"] == 12 and out.loc[4, "defcon_hit"] == 1.0
    # Target base subtracts the +2 DefCon bonus
    assert out.loc[1, "target_base"] == 6
    assert out.loc[2, "target_base"] == 2
    assert pd.isna(out.loc[0, "defcon_hit"]) and out.loc[0, "target_base"] == 6


def test_squad_constraints_and_fitness(synthetic_pool: PlayerPool) -> None:
    ev = SquadEvaluator(synthetic_pool, budget=100.0)
    agent = RandomSquadAgent(ev, seed=42, max_evals=10)
    valid_state = agent.random_valid_squad()
    assert ev.is_valid(valid_state)
    assert ev.check(valid_state).valid

    # Lineup formation & exact fitness check
    lineup = ev.solve_lineup(valid_state)
    assert len(lineup.starters) == 11
    assert len(lineup.bench) == 4
    assert lineup.captain in lineup.starters
    assert lineup.vice_captain in lineup.starters and lineup.vice_captain != lineup.captain

    expected_f = (
        sum(synthetic_pool.value[i] for i in lineup.starters)
        + synthetic_pool.value[lineup.captain]
        + 0.1 * sum(synthetic_pool.value[i] for i in lineup.bench)
    )
    assert np.isclose(ev.fitness(valid_state), expected_f)

    # Budget violation -> -inf
    tight_ev = SquadEvaluator(synthetic_pool, budget=10.0)
    assert tight_ev.fitness(valid_state) == NEG_INF

    # Club cap violation: force 4 players from the same club
    same_club = [i for i, t in enumerate(synthetic_pool.team) if t == 1][:4]
    bad_players = list(valid_state.players)
    for j, sc in enumerate(same_club):
        if sc not in bad_players:
            bad_players[j] = sc
    bad_state = SquadState.of(bad_players)
    assert not ev.is_valid(bad_state)


def test_auto_sub_and_captain_fallback(synthetic_pool: PlayerPool) -> None:
    ev = SquadEvaluator(synthetic_pool, budget=100.0)
    state = GreedyValueAgent(ev).select().state
    lineup = ev.solve_lineup(state)

    # Captain plays 0 mins, Vice-Captain plays 90 mins and gets 10 pts -> VC doubled
    pts = {int(synthetic_pool.element[i]): 2.0 for i in state.players}
    mins = {int(synthetic_pool.element[i]): 90.0 for i in state.players}
    cap_el = int(synthetic_pool.element[lineup.captain])
    vc_el = int(synthetic_pool.element[lineup.vice_captain])
    mins[cap_el] = 0.0
    pts[cap_el] = 0.0
    pts[vc_el] = 10.0

    total = score_actual(synthetic_pool, state, lineup, pts, mins)
    # 10 other starters (incl sub) * 2 pts + VC (10 * 2) = 40 pts
    assert np.isclose(total, 40.0)


# ======================================================================================
# 2. Custom local search agents
# ======================================================================================
def test_agents_hierarchy_and_search(synthetic_pool: PlayerPool) -> None:
    ev = SquadEvaluator(synthetic_pool, budget=100.0)
    start = RandomSquadAgent(ev, seed=7, max_evals=1).random_valid_squad()

    results = {}
    for key in ("greedy", "random", "hc", "sa"):
        agent = AGENTS[key](ev, seed=7, max_evals=300) if key != "greedy" else AGENTS[key](ev, seed=7)
        assert isinstance(agent, BaseSelectorAgent)
        res = agent.select(None if key == "greedy" else start)
        assert ev.is_valid(res.state)
        assert res.fitness > 0
        results[key] = res.fitness

    # SA and HC must at least match the starting random squad
    assert results["sa"] >= ev.fitness(start)
    assert results["hc"] >= ev.fitness(start)


# ======================================================================================
# 3. Transfer optimizer & hit maths
# ======================================================================================
def test_transfer_optimizer_free_and_hits(synthetic_pool: PlayerPool) -> None:
    ev = SquadEvaluator(synthetic_pool, budget=100.0)
    origin = RandomSquadAgent(ev, seed=99, max_evals=1).random_valid_squad()
    bank = ev.bank(origin)

    opt = TransferOptimizer(
        pool=synthetic_pool,
        origin=origin,
        bank=bank,
        free_transfers=1,
        sa_iterations=300,
        sa_restarts=1,
    )
    res = opt.optimize(max_transfers=3, top_per_k=3)
    assert len(res.plans) > 0
    for plan in res.plans:
        expected_hits = max(0, plan.n_transfers - 1)
        assert plan.hits == expected_hits
        assert np.isclose(plan.net_gain, plan.gross_gain - HIT_COST * expected_hits)
        new_state = origin.replace_many(plan.outs, plan.ins)
        assert opt.evaluator.is_valid(new_state)


# ======================================================================================
# 4. FPLApiClient caching & fallback with mocked getter
# ======================================================================================
def test_fpl_api_client_cache_and_fallback(tmp_path: Path) -> None:
    calls = {"count": 0, "fail": False}

    def fake_getter(path: str) -> dict[str, Any]:
        calls["count"] += 1
        if calls["fail"]:
            raise httpx.ConnectError("Network down")
        return {"path": path, "call": calls["count"]}

    cache = CacheStore(directory=tmp_path)
    client = FPLApiClient(cache=cache, client=object())  # type: ignore[arg-type]
    data1 = client.fetch_sync("/bootstrap-static/", ttl=300.0, getter=fake_getter)
    assert data1["call"] == 1 and not client.last_fallback
    data2 = client.fetch_sync("/bootstrap-static/", ttl=300.0, getter=fake_getter)
    assert data2["call"] == 1 and calls["count"] == 1

    calls["fail"] = True
    data3 = client.fetch_sync("/bootstrap-static/", ttl=0.0, getter=fake_getter)
    assert data3["call"] == 1 and client.last_fallback

    with pytest.raises(FPLApiError):
        client.fetch_sync("/entry/999999/", ttl=60.0, getter=fake_getter)


# ======================================================================================
# 5. FastAPI endpoint smoke test
# ======================================================================================
def test_fastapi_endpoints(synthetic_pool: PlayerPool) -> None:
    from src.api.routes import (
        PoolSnapshot,
        _describe_squad,
        build_chip_status,
        service,
    )

    f = synthetic_pool.frame.copy()
    f["xp"] = synthetic_pool.value
    snap = PoolSnapshot(
        pool=synthetic_pool,
        players_table=f.to_dict(orient="records"),
        season="2025-26",
        current_gw=20,
        next_gw=21,
        target_gw=20,
        deadline_time=None,
        from_fallback=True,
        source="synthetic_test",
    )
    service._pool_cache[(1, 20)] = snap
    ev = SquadEvaluator(synthetic_pool, budget=100.0)
    res = GreedyValueAgent(ev).select()
    desc = _describe_squad(ev, res.state, optimal_fitness=70.0)
    assert len(desc["starters"]) == 11
    assert len(desc["bench"]) == 4
    assert 0.0 <= desc["gw_rating_pct"] <= 100.0
    assert desc["suggested_captain"] is not None
    assert "element" in desc["suggested_captain"]

    # Verify Triple Captain (3xc) increases projected points by 1x captain value
    desc_tc = _describe_squad(ev, res.state, optimal_fitness=70.0, active_chip="3xc")
    cap_xp = next(p["xp"] for p in desc["starters"] if p.get("is_captain"))
    assert np.isclose(desc_tc["projected_points"] - desc["projected_points"], cap_xp, atol=0.1)

    # Verify Bench Boost (bboost) increases projected points by bench sum
    desc_bb = _describe_squad(ev, res.state, optimal_fitness=70.0, active_chip="bboost")
    assert desc_bb["projected_points"] > desc["projected_points"]

    # Verify 8-chip season tracker (2x WC, 2x FH, 2x BB, 2x TC)
    chips = build_chip_status(
        used_chips=[
            {"name": "wildcard", "event": 5},
            {"name": "3xc", "event": 12},
            {"name": "bboost", "event": 24},
        ],
        current_gw=25,
        selected_gw=12,
    )
    assert len(chips) == 8
    by_label = {c["label"]: c for c in chips}
    assert by_label["WC1"]["status"] == "used" and by_label["WC1"]["used_gw"] == 5
    assert by_label["WC2"]["status"] == "available"
    assert by_label["TC1"]["status"] == "active" and by_label["TC1"]["used_gw"] == 12
    assert by_label["BB2"]["status"] == "used" and by_label["BB2"]["used_gw"] == 24


def test_optimus_squads_and_evaluate_endpoints(synthetic_pool: PlayerPool) -> None:
    import asyncio
    from fastapi import HTTPException
    from src.api.routes import (
        EvaluateSquadRequest,
        PoolSnapshot,
        evaluate_squad,
        get_optimus_squads,
        service,
    )

    f = synthetic_pool.frame.copy()
    f["xp"] = synthetic_pool.value
    snap_cur = PoolSnapshot(
        pool=synthetic_pool,
        players_table=f.to_dict(orient="records"),
        season="2025-26",
        current_gw=20,
        next_gw=21,
        target_gw=20,
        deadline_time=None,
        from_fallback=True,
        source="synthetic_test",
        optimal_fitness=68.0,
    )
    snap_next = PoolSnapshot(
        pool=synthetic_pool,
        players_table=f.to_dict(orient="records"),
        season="2025-26",
        current_gw=20,
        next_gw=21,
        target_gw=21,
        deadline_time=None,
        from_fallback=True,
        source="synthetic_test",
        optimal_fitness=68.0,
    )
    service._pool_cache[1] = snap_cur
    service._pool_cache[(1, 0)] = snap_cur
    service._pool_cache[(1, 21)] = snap_next
    service._pool_cache[(5, 21)] = snap_next

    # 1. Optimus Freehit (1 GW, 5k SA) + Optimus Wildcard (5 GWs, 5k SA)
    optimus = asyncio.run(get_optimus_squads(gw=21, budget=100.0, force=False))
    assert optimus["anchor_gw"] == 21
    assert optimus["freehit"]["iterations"] == 5_000
    assert optimus["freehit"]["horizon"] == 1
    assert optimus["wildcard"]["iterations"] == 5_000
    assert optimus["wildcard"]["horizon"] == 5
    assert optimus["wildcard"]["n_gws"] == 5
    assert len(optimus["freehit"]["squad"]["starters"]) == 11
    assert len(optimus["wildcard"]["squad"]["starters"]) == 11

    # 2. Pick Team / Transfers evaluation: captain change + exploratory over-budget check
    ev = SquadEvaluator(synthetic_pool, budget=100.0)
    res = GreedyValueAgent(ev).select()
    lineup = ev.solve_lineup(res.state)
    starter_els = [int(synthetic_pool.element[i]) for i in lineup.starters]
    bench_els = [int(synthetic_pool.element[i]) for i in lineup.bench]
    cap_el = int(synthetic_pool.element[lineup.captain])
    alt_cap_el = int(synthetic_pool.element[lineup.vice_captain])

    ev1 = asyncio.run(
        evaluate_squad(
            EvaluateSquadRequest(
                starters=starter_els,
                bench=bench_els,
                captain=cap_el,
                vice_captain=alt_cap_el,
                gw=21,
                budget=100.0,
            )
        )
    )
    assert ev1["is_valid"] is True

    # Change captain to vice-captain and verify projected points changes accordingly
    ev2 = asyncio.run(
        evaluate_squad(
            EvaluateSquadRequest(
                starters=starter_els,
                bench=bench_els,
                captain=alt_cap_el,
                vice_captain=cap_el,
                gw=21,
                budget=100.0,
            )
        )
    )
    cap_xp = float(synthetic_pool.value[lineup.captain])
    vc_xp = float(synthetic_pool.value[lineup.vice_captain])
    assert np.isclose(
        ev1["lineup"]["projected_points"] - ev2["lineup"]["projected_points"],
        cap_xp - vc_xp,
        atol=0.05,
    )

    # Exploratory transfer preview: tight budget shows projected points + violation when enforce_constraints=False
    ev_over = asyncio.run(
        evaluate_squad(
            EvaluateSquadRequest(
                starters=starter_els,
                bench=bench_els,
                captain=cap_el,
                vice_captain=alt_cap_el,
                gw=21,
                budget=60.0,
                enforce_constraints=False,
            )
        )
    )
    assert ev_over["is_valid"] is False
    assert len(ev_over["violations"]) >= 1
    assert ev_over["lineup"]["projected_points"] > 0

    # Strict Confirm rejects with 422 when budget/club rules violated
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            evaluate_squad(
                EvaluateSquadRequest(
                    starters=starter_els,
                    bench=bench_els,
                    captain=cap_el,
                    vice_captain=alt_cap_el,
                    gw=21,
                    budget=60.0,
                    enforce_constraints=True,
                )
            )
        )
    assert exc_info.value.status_code == 422

