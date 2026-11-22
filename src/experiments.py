"""Seeded, fully offline experiment suite for FPL-Optimus.

Usage::

    python src/experiments.py --seed 2026            # full run
    python src/experiments.py --seed 2026 --quick    # fast smoke run

Blocks
------
1. **ML evaluation** - expanding-window chronological evaluation on the held-out 2025-26
   season: HistGradientBoosting vs RidgeCV vs rolling-3 baseline (RMSE/MAE/R^2), plus
   DefCon classifier AUC/Brier/calibration.
2. **GMM archetypes** - per-position GMM with BIC sweep on 2025-26 profiles.
3. **Optimizer benchmark** - every agent x N seeds on one gameweek's out-of-sample xP
   with an equal fitness-evaluation budget and identical random start squads.
4. **Season backtest** - each agent builds the GW1 squad, then a 1-free-transfer
   optimiser runs every week; realised points with captaincy and auto-subs.

Outputs go to ``outputs/results`` (CSV/JSON) and ``outputs/figures`` (PNG). Network
access is blocked inside this process to guarantee offline reproducibility.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import socket
import sys
import time
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("MPLCONFIGDIR", str(Path(__file__).resolve().parents[1] / ".mplcache"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.calibration import calibration_curve  # noqa: E402
from sklearn.metrics import brier_score_loss, roc_auc_score  # noqa: E402

from src.agents import AGENTS, HillClimbingAgent, RandomSquadAgent, SearchResult  # noqa: E402
from src.data_loader import PROCESSED_DIR, PROJECT_ROOT, load_processed  # noqa: E402
from src.environment import SeasonBacktester  # noqa: E402
from src.models import (  # noqa: E402
    ArchetypeClusterer, chronological_evaluation, regression_metrics, season_player_aggregates,
)
from src.squad import SquadEvaluator  # noqa: E402

logger = logging.getLogger("experiments")

RESULTS_DIR = PROJECT_ROOT / "outputs" / "results"
FIGURES_DIR = PROJECT_ROOT / "outputs" / "figures"
TEST_SEASON = "2025-26"
AGENT_COLORS = {
    "SimulatedAnnealing": "#d62728", "HillClimbing": "#1f77b4",
    "HillClimbing (no restart)": "#9ecae1", "Greedy": "#2ca02c", "Random": "#7f7f7f",
}


def block_network() -> None:
    """Make any socket connection attempt in this process fail loudly."""

    def _deny(*_: Any, **__: Any) -> None:
        raise RuntimeError("Network access is disabled in the offline experiment suite")

    socket.socket.connect = _deny  # type: ignore[method-assign]
    socket.create_connection = _deny  # type: ignore[assignment]


def seed_everything(seed: int) -> None:
    """Seed Python and NumPy global RNGs."""
    random.seed(seed)
    np.random.seed(seed)


def _save_fig(fig: plt.Figure, name: str) -> None:
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / name, dpi=150)
    plt.close(fig)


# ======================================================================================
# Block 1 - ML
# ======================================================================================
def run_ml_block(df: pd.DataFrame, seed: int, block_size: int) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Chronological evaluation; returns OOS predictions and a metrics summary."""
    metrics, preds = chronological_evaluation(df, test_season=TEST_SEASON, block_size=block_size,
                                              random_state=seed)
    played = preds[preds["minutes"] > 0]
    played_metrics = pd.DataFrame(
        [{"model": m, **regression_metrics(played["target_base"], played[f"pred_{k}"])}
         for k, m in (("hgb", "HistGradientBoosting"), ("ridge", "RidgeCV"), ("rolling3", "Rolling3Avg"))]
    )
    metrics.insert(1, "subset", "all fixtures")
    played_metrics.insert(1, "subset", "minutes > 0")
    table = pd.concat([metrics, played_metrics], ignore_index=True)
    table.to_csv(RESULTS_DIR / "ml_metrics.csv", index=False)

    dc = preds[preds["defcon_hit"].notna()]
    defcon = {
        "auc": float(roc_auc_score(dc["defcon_hit"], dc["p_defcon"])),
        "brier": float(brier_score_loss(dc["defcon_hit"], dc["p_defcon"])),
        "base_rate": float(dc["defcon_hit"].mean()),
        "n": int(len(dc)),
    }
    pd.DataFrame([defcon]).to_csv(RESULTS_DIR / "defcon_classifier_metrics.csv", index=False)
    preds.to_csv(PROCESSED_DIR / "oos_predictions.csv", index=False)

    # Per-GW RMSE
    fig, ax = plt.subplots(figsize=(9, 4))
    for k, label in (("hgb", "HistGradientBoosting"), ("ridge", "RidgeCV"), ("rolling3", "Rolling-3 avg")):
        per_gw = preds.groupby("gw").apply(
            lambda g, k=k: np.sqrt(np.mean((g["target_base"] - g[f"pred_{k}"]) ** 2)), include_groups=False
        )
        ax.plot(per_gw.index, per_gw.values, marker="o", ms=3, label=label)
    ax.set(xlabel=f"Gameweek ({TEST_SEASON})", ylabel="RMSE (points)", title="Out-of-sample RMSE per gameweek")
    ax.legend()
    _save_fig(fig, "ml_rmse_per_gw.png")

    # Calibration of xP (binned predicted vs actual)
    fig, ax = plt.subplots(figsize=(5, 5))
    for k, label in (("hgb", "HGB"), ("ridge", "Ridge"), ("rolling3", "Rolling-3")):
        bins = pd.qcut(preds[f"pred_{k}"], 20, duplicates="drop")
        g = preds.groupby(bins, observed=True).agg(p=(f"pred_{k}", "mean"), a=("target_base", "mean"))
        ax.plot(g["p"], g["a"], marker="o", ms=3, label=label)
    lim = [0, max(1.0, float(preds["target_base"].quantile(0.99)))]
    ax.plot(lim, lim, "k--", lw=1)
    ax.set(xlabel="Mean predicted xP", ylabel="Mean actual points", title="xP calibration (20 quantile bins)")
    ax.legend()
    _save_fig(fig, "ml_calibration.png")

    # DefCon reliability diagram
    frac, mean_pred = calibration_curve(dc["defcon_hit"], dc["p_defcon"], n_bins=10, strategy="quantile")
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.plot(mean_pred, frac, marker="o", label=f"HGB+isotonic (AUC {defcon['auc']:.3f})")
    ax.plot([0, 1], [0, 1], "k--", lw=1)
    ax.set(xlabel="Predicted P(DefCon hit)", ylabel="Observed frequency", title="DefCon probability calibration")
    ax.legend()
    _save_fig(fig, "defcon_calibration.png")

    return preds, {"regression": table.to_dict(orient="records"), "defcon": defcon}


# ======================================================================================
# Block 2 - GMM
# ======================================================================================
def run_gmm_block(df: pd.DataFrame, seed: int) -> dict[str, Any]:
    """Fit per-position GMMs and export archetypes, BIC curves and a scatter plot."""
    profiles = season_player_aggregates(df, TEST_SEASON)
    clusterer = ArchetypeClusterer(random_state=seed).fit(profiles)
    arche = clusterer.transform(profiles).merge(
        profiles[["element", "name", "team_id", "cost", "minutes", "xg_per90", "xa_per90",
                  "cbit_per90", "cbirt_per90", "defcon_hit_rate", "clean_sheets_per90", "total_points", "low_sample"]],
        on="element",
    )
    arche.drop(columns=["posteriors"]).to_csv(RESULTS_DIR / "gmm_archetypes.csv", index=False)
    summary = clusterer.summary()
    summary.to_csv(RESULTS_DIR / "gmm_summary.csv", index=False)

    fig, axes = plt.subplots(1, 4, figsize=(14, 3.5))
    for ax, (pos, m) in zip(axes, clusterer.models.items()):
        ks, bics = zip(*sorted(m.bic_curve.items()))
        ax.plot(ks, bics, marker="o")
        ax.axvline(m.gmm.n_components, color="r", ls="--", lw=1)
        ax.set(title=f"{pos}: BIC (k*={m.gmm.n_components})", xlabel="k", ylabel="BIC")
    _save_fig(fig, "gmm_bic.png")

    out = arche[(arche["position"] != "GK") & ~arche["low_sample"]]
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    for ax, pos in zip(axes, ("DEF", "MID", "FWD")):
        d = out[out["position"] == pos]
        for name, g in d.groupby("archetype"):
            ax.scatter(g["defcon_hit_rate"], g["xg_per90"] + g["xa_per90"], s=(g["cost"] - 3.5) * 25,
                       alpha=0.65, label=name)
        ax.set(title=f"{pos} archetypes ({TEST_SEASON})", xlabel="DefCon hit rate", ylabel="xG + xA per 90")
        ax.legend(fontsize=7)
    _save_fig(fig, "gmm_archetypes_scatter.png")
    return {"summary": summary.assign(bic=summary["bic"].astype(str)).to_dict(orient="records")}


# ======================================================================================
# Block 3 - optimizer benchmark
# ======================================================================================
def run_benchmark_block(preds: pd.DataFrame, seed: int, runs: int, gw: int, budget_evals: int) -> dict[str, Any]:
    """Agents x seeds on one GW with equal evaluation budget and shared start squads."""
    bt = SeasonBacktester(preds)
    pool = bt.pool_for(gw)
    ev = SquadEvaluator(pool)
    configs: list[tuple[str, Any, dict[str, Any]]] = [
        ("SimulatedAnnealing", AGENTS["sa"], {"iterations": budget_evals - 1, "max_evals": budget_evals}),
        ("HillClimbing", HillClimbingAgent, {"restarts": True, "max_evals": budget_evals}),
        ("HillClimbing (no restart)", HillClimbingAgent, {"restarts": False, "max_evals": budget_evals}),
        ("Random", AGENTS["random"], {"max_evals": budget_evals}),
        ("Greedy", AGENTS["greedy"], {}),
    ]
    rows: list[dict[str, Any]] = []
    curves: dict[str, list[np.ndarray]] = {name: [] for name, *_ in configs}
    temperature: list[float] = []
    for r in range(runs):
        run_seed = seed + r
        start = RandomSquadAgent(ev, seed=run_seed, max_evals=1).random_valid_squad()
        for name, cls, kwargs in configs:
            agent = cls(ev, seed=run_seed, **kwargs)
            res: SearchResult = agent.select(None if name == "Greedy" else start)
            rows.append({"agent": name, "run": r, "seed": run_seed, "fitness": res.fitness,
                         "evaluations": res.evaluations, "runtime_s": res.runtime_s, **{f"meta_{k}": v for k, v in res.meta.items()}})
            if name != "Greedy":
                ev_axis = np.array([h["evals"] for h in res.history])
                best = np.array([h["best"] for h in res.history])
                grid = np.arange(1, budget_evals + 1)
                curves[name].append(np.interp(grid, ev_axis, best))
            if name == "SimulatedAnnealing" and r == 0:
                temperature = [h["temperature"] for h in res.history]
                sa_current = [h["current"] for h in res.history]
                sa_best = [h["best"] for h in res.history]
                best_desc = ev.describe(res.state)
        logger.info("Benchmark run %d/%d done", r + 1, runs)

    raw = pd.DataFrame(rows)
    raw.to_csv(RESULTS_DIR / "optimizer_runs.csv", index=False)
    summary = raw.groupby("agent").agg(
        mean_fitness=("fitness", "mean"), std_fitness=("fitness", "std"), best_fitness=("fitness", "max"),
        worst_fitness=("fitness", "min"), mean_runtime_s=("runtime_s", "mean"), mean_evaluations=("evaluations", "mean"),
    ).reset_index().sort_values("mean_fitness", ascending=False)
    summary.to_csv(RESULTS_DIR / "optimizer_summary.csv", index=False)

    # Convergence plot
    fig, ax = plt.subplots(figsize=(9, 5))
    grid = np.arange(1, budget_evals + 1)
    for name, cs in curves.items():
        if not cs:
            continue
        arr = np.vstack(cs)
        m, s = arr.mean(axis=0), arr.std(axis=0)
        ax.plot(grid, m, label=name, color=AGENT_COLORS.get(name))
        ax.fill_between(grid, m - s, m + s, alpha=0.15, color=AGENT_COLORS.get(name))
    greedy_f = raw.loc[raw["agent"] == "Greedy", "fitness"].iloc[0]
    ax.axhline(greedy_f, color=AGENT_COLORS["Greedy"], ls="--", label="Greedy")
    ax.set(xlabel="Fitness evaluations", ylabel="Best fitness so far",
           title=f"Optimizer convergence (GW{gw}, mean ± sd over {runs} seeds)")
    ax.legend()
    _save_fig(fig, "optimizer_convergence.png")

    # SA trace with temperature
    fig, ax1 = plt.subplots(figsize=(9, 4.5))
    ax1.plot(sa_current, lw=0.6, alpha=0.6, label="current F(S)", color="#ff9896")
    ax1.plot(sa_best, lw=1.5, label="best F(S)", color="#d62728")
    ax1.set(xlabel="Iteration", ylabel="Fitness")
    ax2 = ax1.twinx()
    ax2.semilogy(temperature, color="#1f77b4", lw=1, label="temperature")
    ax2.set_ylabel("Temperature (log)")
    ax1.legend(loc="lower right")
    ax1.set_title("Simulated annealing trace (seed run 0)")
    _save_fig(fig, "sa_trace_temperature.png")

    # Box plot
    fig, ax = plt.subplots(figsize=(8, 4.5))
    order = summary["agent"].tolist()
    ax.boxplot([raw.loc[raw["agent"] == a, "fitness"] for a in order], tick_labels=order)
    ax.set(ylabel="Final fitness", title=f"Final fitness distribution ({runs} seeds)")
    plt.setp(ax.get_xticklabels(), rotation=15)
    _save_fig(fig, "optimizer_boxplot.png")

    convergence = {name: np.vstack(cs).mean(axis=0)[:: max(1, budget_evals // 200)].round(3).tolist()
                   for name, cs in curves.items() if cs}
    return {
        "gameweek": int(gw), "runs": runs, "eval_budget": budget_evals,
        "summary": summary.to_dict(orient="records"),
        "convergence_mean_best": convergence,
        "convergence_eval_step": max(1, budget_evals // 200),
        "sa_trace": {"temperature": temperature[::25], "current": sa_current[::25], "best": sa_best[::25]},
        "best_sa_squad": best_desc,
    }


# ======================================================================================
# Block 4 - season backtest
# ======================================================================================
def run_backtest_block(preds: pd.DataFrame, seed: int, sa_iterations: int) -> dict[str, Any]:
    """Season replay for every agent; cumulative realised points."""
    bt = SeasonBacktester(preds)
    results = {}
    for key in ("sa", "hc", "greedy", "random"):
        kwargs: dict[str, Any] = {"iterations": sa_iterations} if key == "sa" else {}
        t0 = time.perf_counter()
        res = bt.run(key, seed=seed, agent_kwargs=kwargs)
        res.gw_points.assign(agent=res.agent).to_csv(RESULTS_DIR / f"backtest_{key}.csv", index=False)
        results[res.agent] = res.gw_points
        logger.info("Backtest %s: %.0f pts (%.1fs)", res.agent, res.gw_points["points"].sum(), time.perf_counter() - t0)

    fig, ax = plt.subplots(figsize=(9, 5))
    for name, gp in results.items():
        ax.plot(gp["gw"], gp["cumulative"], label=f"{name} ({gp['points'].sum():.0f})", color=AGENT_COLORS.get(name))
    ax.set(xlabel=f"Gameweek ({TEST_SEASON})", ylabel="Cumulative points",
           title="Season backtest: realised points (1 FT/week, no chips)")
    ax.legend()
    _save_fig(fig, "backtest_cumulative.png")

    summary = pd.DataFrame(
        [{"agent": n, "total_points": float(g["points"].sum()), "mean_gw_points": float(g["points"].mean()),
          "transfers": int(g["transfers"].sum()), "best_gw": float(g["points"].max())} for n, g in results.items()]
    ).sort_values("total_points", ascending=False)
    summary.to_csv(RESULTS_DIR / "backtest_summary.csv", index=False)
    return {"summary": summary.to_dict(orient="records"),
            "cumulative": {n: g["cumulative"].tolist() for n, g in results.items()}}


# ======================================================================================
def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description="FPL-Optimus offline experiment suite")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--runs", type=int, default=30, help="Seeds per agent in the optimizer benchmark")
    parser.add_argument("--benchmark-gw", type=int, default=20)
    parser.add_argument("--eval-budget", type=int, default=5_000)
    parser.add_argument("--block-size", type=int, default=5, help="GWs per retraining block in ML eval")
    parser.add_argument("--quick", action="store_true", help="Fewer runs/larger blocks for a fast smoke test")
    parser.add_argument("--skip-backtest", action="store_true")
    args = parser.parse_args(argv)
    if args.quick:
        args.runs, args.block_size = 3, 19

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    block_network()
    seed_everything(args.seed)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}

    t = time.perf_counter()
    df = load_processed()
    timings["data"] = time.perf_counter() - t

    t = time.perf_counter()
    preds, ml = run_ml_block(df, args.seed, args.block_size)
    timings["ml"] = time.perf_counter() - t
    logger.info("ML block done in %.1fs", timings["ml"])

    t = time.perf_counter()
    gmm = run_gmm_block(df, args.seed)
    timings["gmm"] = time.perf_counter() - t

    t = time.perf_counter()
    bench = run_benchmark_block(preds, args.seed, args.runs, args.benchmark_gw, args.eval_budget)
    timings["benchmark"] = time.perf_counter() - t
    logger.info("Benchmark block done in %.1fs", timings["benchmark"])

    backtest: dict[str, Any] = {}
    if not args.skip_backtest:
        t = time.perf_counter()
        backtest = run_backtest_block(preds, args.seed, sa_iterations=args.eval_budget)
        timings["backtest"] = time.perf_counter() - t

    payload = {"seed": args.seed, "test_season": TEST_SEASON, "timings_s": timings,
               "ml": ml, "gmm": gmm, "optimizer": bench, "backtest": backtest}
    (RESULTS_DIR / "benchmarks.json").write_text(json.dumps(payload, indent=2, default=float), encoding="utf-8")
    logger.info("All done in %.1fs. Results in %s", sum(timings.values()), RESULTS_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
