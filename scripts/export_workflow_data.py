"""Export offline pipeline results into frontend/data/workflowData.json.

Reads benchmarks, GMM archetypes, optimizer run logs, season backtests,
OOS predictions, and feature metadata to build a compact JSON dataset
matching frontend/lib/workflowTypes.ts.

Usage:
    python scripts/export_workflow_data.py
"""

from __future__ import annotations

import ast
import csv
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

PROJECT_ROOT: Path = Path(__file__).resolve().parents[1]
RESULTS_DIR: Path = PROJECT_ROOT / "outputs" / "results"
PROCESSED_DIR: Path = PROJECT_ROOT / "data" / "processed"
RAW_TEAMS_PATH: Path = PROJECT_ROOT / "data" / "raw" / "2025-26" / "teams.csv"
OUTPUT_PATH: Path = PROJECT_ROOT / "frontend" / "data" / "workflowData.json"

SPOTLIGHT_QUERIES: tuple[tuple[str, ...], ...] = (
    ("Declan Rice", "Rice"),
    ("'Rodri'", "Hernandez Cascante", "Rodri"),
    ("Dominik Szoboszlai", "Szoboszlai"),
    ("Marc Cucurella", "Cucurella"),
    ("Jurriën Timber", "Timber"),
    ("Mohamed Salah", "Salah"),
    ("Cole Palmer", "Palmer"),
    ("Bukayo Saka", "Saka"),
)

MAX_JSON_BYTES: int = 200 * 1024


def sanitize_text(value: Any) -> str:
    """Return clean UTF-8 text with em-dashes and en-dashes replaced by hyphens."""
    text = str(value).strip()
    return text.replace("\u2014", "-").replace("\u2013", "-")


def round_compact(value: float, decimals: int = 3) -> int | float:
    """Round float to ``decimals`` and collapse exact whole numbers to int."""
    val = round(float(value), decimals)
    if val == 0.0:
        return 0
    if val.is_integer():
        return int(val)
    return val


def to_num_or_int(value: float) -> int | float:
    """Convert whole-valued floats to int for cleaner JSON serialization."""
    return round_compact(value, 2)


def count_csv_shape(csv_path: Path) -> tuple[int, int]:
    """Count data rows and columns of a CSV file without loading it all into memory."""
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, [])
        row_count = sum(1 for _ in reader)
    return row_count, len(header)


def build_per_gw_rmse(oos: pd.DataFrame) -> list[dict[str, Any]]:
    """Compute per-gameweek RMSE for HGB, Ridge, and Rolling3 against target_base."""
    points: list[dict[str, Any]] = []
    for gw, grp in oos.groupby("gw", sort=True):
        entry: dict[str, Any] = {"gw": int(gw)}
        for key, col in (("hgb", "pred_hgb"), ("ridge", "pred_ridge"), ("rolling3", "pred_rolling3")):
            valid = grp[["target_base", col]].dropna()
            rmse = float(np.sqrt(np.mean((valid["target_base"] - valid[col]) ** 2)))
            entry[key] = round(rmse, 4)
        points.append(entry)
    return points


def build_calibration_bins(oos: pd.DataFrame, pred_col: str, n_bins: int = 15) -> list[dict[str, Any]]:
    """Bin predictions by quantiles and compare mean predicted vs actual base points."""
    valid = oos[[pred_col, "target_base"]].dropna().copy()
    valid["bin_cat"] = pd.qcut(valid[pred_col], q=n_bins, duplicates="drop")
    grouped = (
        valid.groupby("bin_cat", observed=True)
        .agg(
            meanPred=(pred_col, "mean"),
            meanActual=("target_base", "mean"),
            count=("target_base", "size"),
        )
        .reset_index(drop=True)
    )
    return [
        {
            "bin": idx + 1,
            "meanPred": round(float(row["meanPred"]), 4),
            "meanActual": round(float(row["meanActual"]), 4),
            "count": int(row["count"]),
        }
        for idx, row in grouped.iterrows()
    ]


def build_defcon_reliability(oos: pd.DataFrame, n_bins: int = 10) -> list[dict[str, Any]]:
    """Compute 10-bin quantile reliability curve for outfield DefCon hit probabilities."""
    outfield = oos[
        (oos["position"] != "GK") & oos["p_defcon"].notna() & oos["defcon_hit"].notna()
    ][["p_defcon", "defcon_hit"]].copy()
    outfield["bin_cat"] = pd.qcut(outfield["p_defcon"], q=n_bins, duplicates="drop")
    grouped = (
        outfield.groupby("bin_cat", observed=True)
        .agg(
            meanProb=("p_defcon", "mean"),
            empiricalRate=("defcon_hit", "mean"),
            count=("defcon_hit", "size"),
        )
        .reset_index(drop=True)
    )
    return [
        {
            "bin": idx + 1,
            "meanProb": round(float(row["meanProb"]), 4),
            "empiricalRate": round(float(row["empiricalRate"]), 4),
            "count": int(row["count"]),
        }
        for idx, row in grouped.iterrows()
    ]


def row_to_gmm_player(row: pd.Series) -> dict[str, Any]:
    """Convert one row of gmm_archetypes.csv (with team_short) to GmmPlayerPoint."""
    player: dict[str, Any] = {
        "element": int(row["element"]),
        "name": sanitize_text(row["name"]),
        "position": sanitize_text(row["position"]),
        "cost": round_compact(row["cost"], 1),
        "minutes": int(row["minutes"]),
        "archetype": sanitize_text(row["archetype"]),
        "confidence": round_compact(row["archetype_confidence"], 3),
        "pDefconAnchor": round_compact(row["p_defcon_anchor"], 3),
        "pAttackingOutlet": round_compact(row["p_attacking_outlet"], 3),
        "xgPer90": round_compact(row["xg_per90"], 3),
        "xaPer90": round_compact(row["xa_per90"], 3),
        "cbitPer90": round_compact(row["cbit_per90"], 2),
        "cbirtPer90": round_compact(row["cbirt_per90"], 2),
        "defconHitRate": round_compact(row["defcon_hit_rate"], 3),
        "totalPoints": int(row["total_points"]),
    }
    if pd.notna(row.get("team_short")) and str(row["team_short"]).strip():
        player["teamShort"] = sanitize_text(row["team_short"])
    return player


def select_spotlights(valid_df: pd.DataFrame, target_count: int = 8) -> list[dict[str, Any]]:
    """Select notable real players for spotlight cards, with confidence-based fallbacks."""
    picked_elements: set[int] = set()
    selected_rows: list[pd.Series] = []

    for candidates in SPOTLIGHT_QUERIES:
        matched_row: pd.Series | None = None
        for query in candidates:
            hits = valid_df[
                (~valid_df["element"].isin(picked_elements))
                & valid_df["name"].str.contains(query, case=False, regex=False, na=False)
            ]
            if not hits.empty:
                matched_row = hits.sort_values(
                    ["total_points", "archetype_confidence", "minutes"],
                    ascending=[False, False, False],
                ).iloc[0]
                break
        if matched_row is not None:
            picked_elements.add(int(matched_row["element"]))
            selected_rows.append(matched_row)

    if len(selected_rows) < target_count:
        remaining = valid_df[~valid_df["element"].isin(picked_elements)].sort_values(
            ["archetype_confidence", "total_points", "minutes"],
            ascending=[False, False, False],
        )
        for _, row in remaining.iterrows():
            if len(selected_rows) >= target_count:
                break
            picked_elements.add(int(row["element"]))
            selected_rows.append(row)

    return [row_to_gmm_player(row) for row in selected_rows]


def build_gmm_section(
    benchmarks_gmm: dict[str, Any], gmm_df: pd.DataFrame, teams_df: pd.DataFrame
) -> dict[str, Any]:
    """Parse GMM summary BIC dicts, filter qualified players, and pick spotlights."""
    summary: list[dict[str, Any]] = []
    for item in benchmarks_gmm["summary"]:
        raw_bic = ast.literal_eval(str(item["bic"]))
        bic = {str(k): round(float(v), 2) for k, v in sorted(raw_bic.items(), key=lambda kv: int(kv[0]))}
        archetypes = [sanitize_text(part) for part in str(item["archetypes"]).split(",") if part.strip()]
        summary.append(
            {
                "position": sanitize_text(item["position"]),
                "k": int(item["k"]),
                "archetypes": archetypes,
                "bic": bic,
            }
        )

    team_map = dict(zip(teams_df["id"], teams_df["short_name"]))
    merged = gmm_df.copy()
    merged["team_short"] = merged["team_id"].map(team_map)

    low_sample_bool = merged["low_sample"].astype(str).str.lower().isin({"true", "1"})
    qualified = merged[(~low_sample_bool) & (merged["minutes"] >= 450)].sort_values(
        ["total_points", "minutes", "element"], ascending=[False, False, True]
    )

    players = [row_to_gmm_player(row) for _, row in qualified.iterrows()]
    spotlights = select_spotlights(qualified, target_count=8)

    return {
        "summary": summary,
        "players": players,
        "spotlights": spotlights,
    }


def build_optimizer_section(benchmarks_opt: dict[str, Any], runs_df: pd.DataFrame) -> dict[str, Any]:
    """Build optimizer summary, per-seed scatter rows, convergence curves, and SA trace."""
    eval_budget = int(benchmarks_opt["eval_budget"])
    summary = [
        {
            "agent": sanitize_text(row["agent"]),
            "meanFitness": round(float(row["mean_fitness"]), 4),
            "stdFitness": round(float(row["std_fitness"]), 4),
            "bestFitness": round(float(row["best_fitness"]), 4),
            "worstFitness": round(float(row["worst_fitness"]), 4),
            "meanRuntimeS": round(float(row["mean_runtime_s"]), 4),
            "meanEvaluations": round(float(row["mean_evaluations"]), 2),
        }
        for row in benchmarks_opt["summary"]
    ]

    runs_by_seed: list[dict[str, Any]] = []
    for _, row in runs_df.iterrows():
        dot: dict[str, Any] = {
            "agent": sanitize_text(row["agent"]),
            "seed": int(row["seed"]),
            "fitness": round_compact(row["fitness"], 3),
            "evaluations": int(row["evaluations"]),
            "runtimeS": round_compact(row["runtime_s"], 3),
        }
        if pd.notna(row.get("meta_worse_accepted")):
            dot["worseAccepted"] = int(row["meta_worse_accepted"])
        if pd.notna(row.get("meta_restarts")):
            dot["restarts"] = int(row["meta_restarts"])
        runs_by_seed.append(dot)

    conv_curves = {
        sanitize_text(agent): [round_compact(v, 3) for v in values]
        for agent, values in benchmarks_opt["convergence_mean_best"].items()
    }

    raw_trace = benchmarks_opt["sa_trace"]
    temps = raw_trace["temperature"]
    currents = raw_trace["current"]
    bests = raw_trace["best"]
    n_steps = len(temps)
    denom = max(1, n_steps - 1)
    sa_trace = [
        {
            "step": step,
            "iter": int(round(step * eval_budget / denom)),
            "temperature": round_compact(temp, 5),
            "current": round_compact(curr, 3),
            "best": round_compact(best, 3),
        }
        for step, (temp, curr, best) in enumerate(zip(temps, currents, bests))
    ]

    return {
        "gameweek": int(benchmarks_opt["gameweek"]),
        "runs": int(benchmarks_opt["runs"]),
        "evalBudget": eval_budget,
        "summary": summary,
        "runsBySeed": runs_by_seed,
        "convergenceEvalStep": int(benchmarks_opt["convergence_eval_step"]),
        "convergenceMeanBest": conv_curves,
        "saTrace": sa_trace,
    }


def build_backtest_section(
    benchmarks_bt: dict[str, Any], bt_frames: dict[str, pd.DataFrame]
) -> dict[str, Any]:
    """Build backtest summary and 38-GW joined trajectory across all 4 agents."""
    summary = [
        {
            "agent": sanitize_text(row["agent"]),
            "totalPoints": to_num_or_int(row["total_points"]),
            "meanGwPoints": round(float(row["mean_gw_points"]), 4),
            "transfers": int(row["transfers"]),
            "bestGw": to_num_or_int(row["best_gw"]),
        }
        for row in benchmarks_bt["summary"]
    ]

    merged: pd.DataFrame | None = None
    for key in ("sa", "hc", "random", "greedy"):
        df = bt_frames[key][["gw", "cumulative", "points", "captain"]].rename(
            columns={
                "cumulative": f"cumulative_{key}",
                "points": f"points_{key}",
                "captain": f"captain_{key}",
            }
        )
        merged = df if merged is None else merged.merge(df, on="gw", how="inner")

    assert merged is not None
    merged = merged.sort_values("gw").reset_index(drop=True)

    trajectory = [
        {
            "gw": int(row["gw"]),
            "sa": to_num_or_int(row["cumulative_sa"]),
            "hc": to_num_or_int(row["cumulative_hc"]),
            "random": to_num_or_int(row["cumulative_random"]),
            "greedy": to_num_or_int(row["cumulative_greedy"]),
            "saGwPts": to_num_or_int(row["points_sa"]),
            "hcGwPts": to_num_or_int(row["points_hc"]),
            "randomGwPts": to_num_or_int(row["points_random"]),
            "greedyGwPts": to_num_or_int(row["points_greedy"]),
            "saCaptain": sanitize_text(row["captain_sa"]),
        }
        for _, row in merged.iterrows()
    ]

    return {
        "summary": summary,
        "trajectory": trajectory,
    }


def validate_payload(payload: Any, json_text: str) -> None:
    """Assert zero NaN/Inf floats, zero em/en-dashes, and compact file size."""
    if "\u2014" in json_text or "\u2013" in json_text:
        raise ValueError("Found prohibited em-dash or en-dash in serialized workflowData.json")

    def _walk(node: Any) -> None:
        if isinstance(node, float):
            if math.isnan(node) or math.isinf(node):
                raise ValueError(f"Found non-finite float: {node}")
        elif isinstance(node, dict):
            for k, v in node.items():
                if "\u2014" in str(k) or "\u2013" in str(k):
                    raise ValueError(f"Found dash in key: {k}")
                _walk(v)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(payload)
    byte_size = len(json_text.encode("utf-8"))
    if byte_size >= MAX_JSON_BYTES:
        raise ValueError(f"workflowData.json is too large: {byte_size} bytes >= {MAX_JSON_BYTES}")


def export_workflow_data() -> dict[str, Any]:
    """Load pipeline artifacts, transform to WorkflowDataset, validate, and write JSON."""
    with (RESULTS_DIR / "benchmarks.json").open("r", encoding="utf-8") as fh:
        benchmarks = json.load(fh)

    oos_df = pd.read_csv(PROCESSED_DIR / "oos_predictions.csv")
    total_records, engineered_columns = count_csv_shape(PROCESSED_DIR / "features.csv")
    gmm_df = pd.read_csv(RESULTS_DIR / "gmm_archetypes.csv")
    teams_df = pd.read_csv(RAW_TEAMS_PATH)
    runs_df = pd.read_csv(RESULTS_DIR / "optimizer_runs.csv")
    bt_frames = {
        key: pd.read_csv(RESULTS_DIR / f"backtest_{key}.csv")
        for key in ("sa", "hc", "random", "greedy")
    }

    timings_raw = benchmarks["timings_s"]
    defcon_raw = benchmarks["ml"]["defcon"]

    payload: dict[str, Any] = {
        "meta": {
            "seed": int(benchmarks["seed"]),
            "testSeason": sanitize_text(benchmarks["test_season"]),
            "totalRecords": int(total_records),
            "engineeredColumns": int(engineered_columns),
            "oosFixtures": int(len(oos_df)),
            "timingsS": {
                "data": round(float(timings_raw["data"]), 2),
                "ml": round(float(timings_raw["ml"]), 2),
                "gmm": round(float(timings_raw["gmm"]), 2),
                "benchmark": round(float(timings_raw["benchmark"]), 2),
                "backtest": round(float(timings_raw["backtest"]), 2),
            },
        },
        "ml": {
            "regression": [
                {
                    "model": sanitize_text(row["model"]),
                    "subset": sanitize_text(row["subset"]),
                    "rmse": round(float(row["rmse"]), 4),
                    "mae": round(float(row["mae"]), 4),
                    "r2": round(float(row["r2"]), 4),
                }
                for row in benchmarks["ml"]["regression"]
            ],
            "defcon": {
                "auc": round(float(defcon_raw["auc"]), 4),
                "brier": round(float(defcon_raw["brier"]), 4),
                "baseRate": round(float(defcon_raw["base_rate"]), 4),
                "n": int(defcon_raw["n"]),
            },
            "perGwRmse": build_per_gw_rmse(oos_df),
            "calibration": {
                "hgb": build_calibration_bins(oos_df, "pred_hgb", n_bins=15),
                "ridge": build_calibration_bins(oos_df, "pred_ridge", n_bins=15),
                "rolling3": build_calibration_bins(oos_df, "pred_rolling3", n_bins=15),
            },
            "defconReliability": build_defcon_reliability(oos_df, n_bins=10),
        },
        "gmm": build_gmm_section(benchmarks["gmm"], gmm_df, teams_df),
        "optimizer": build_optimizer_section(benchmarks["optimizer"], runs_df),
        "backtest": build_backtest_section(benchmarks["backtest"], bt_frames),
    }

    json_text = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    validate_payload(payload, json_text)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json_text, encoding="utf-8")
    return payload


def main() -> int:
    """Run export and print verification summary."""
    payload = export_workflow_data()
    size_bytes = OUTPUT_PATH.stat().st_size
    print(f"Wrote {OUTPUT_PATH} ({size_bytes:,} bytes / {size_bytes / 1024:.2f} KB)")
    print(
        f"meta: totalRecords={payload['meta']['totalRecords']}, "
        f"engineeredColumns={payload['meta']['engineeredColumns']}, "
        f"oosFixtures={payload['meta']['oosFixtures']}"
    )
    print(
        f"ml: regression={len(payload['ml']['regression'])}, "
        f"perGwRmse={len(payload['ml']['perGwRmse'])}, "
        f"cal(hgb/ridge/roll3)=({len(payload['ml']['calibration']['hgb'])}/"
        f"{len(payload['ml']['calibration']['ridge'])}/"
        f"{len(payload['ml']['calibration']['rolling3'])}), "
        f"defconReliability={len(payload['ml']['defconReliability'])}"
    )
    print(
        f"gmm: summary={len(payload['gmm']['summary'])}, "
        f"players={len(payload['gmm']['players'])}, "
        f"spotlights={len(payload['gmm']['spotlights'])}"
    )
    print(
        f"optimizer: summary={len(payload['optimizer']['summary'])}, "
        f"runsBySeed={len(payload['optimizer']['runsBySeed'])}, "
        f"saTrace={len(payload['optimizer']['saTrace'])}"
    )
    print(
        f"backtest: summary={len(payload['backtest']['summary'])}, "
        f"trajectory={len(payload['backtest']['trajectory'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
