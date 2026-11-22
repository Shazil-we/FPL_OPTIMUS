"use client";

import React, { useState } from "react";
import { ChartScatter, TrendUp } from "@phosphor-icons/react";

export interface ConvergencePoint {
  iter: number;
  evals: number;
  temperature?: number;
  current: number;
  best: number;
}

export interface GMMPlayerPoint {
  element: number;
  name: string;
  position: string;
  team_short?: string;
  status?: string;
  low_sample?: boolean;
  cost?: number;
  price?: number;
  archetype: string;
  defcon_hit_rate?: number;
  xg_per90?: number;
  xa_per90?: number;
  p_defcon_anchor?: number;
  p_attacking_outlet?: number;
}

export default function Charts({
  liveConvergence,
  benchmarks,
  playersPool,
}: {
  liveConvergence: ConvergencePoint[];
  benchmarks: any | null;
  playersPool: GMMPlayerPoint[];
}) {
  const [posFilter, setPosFilter] = useState<string>("MID");

  const convPoints: ConvergencePoint[] =
    liveConvergence && liveConvergence.length > 1
      ? liveConvergence
      : benchmarks?.optimizer?.sa_trace
      ? benchmarks.optimizer.sa_trace.best.map((b: number, idx: number) => ({
          iter: idx * 25,
          evals: idx * 25,
          best: b,
          current: benchmarks.optimizer.sa_trace.current[idx] ?? b,
          temperature: benchmarks.optimizer.sa_trace.temperature[idx] ?? 0,
        }))
      : [];

  const renderConvergenceSvg = () => {
    if (convPoints.length < 2) {
      return (
        <div className="bg-ink-950 rounded-lg border border-ink-700 text-xs text-mist-300 py-8 px-4 text-center">
          Run <strong>Build Optimal Squad</strong> or load offline benchmarks to view
          convergence curves.
        </div>
      );
    }
    const w = 520;
    const h = 190;
    const pad = 28;
    const vals = convPoints.flatMap((p) => [p.best, p.current]);
    const minY = Math.min(...vals);
    const maxY = Math.max(...vals, minY + 1);
    const maxX = Math.max(convPoints.length - 1, 1);

    const toXY = (i: number, v: number) => {
      const x = pad + (i / maxX) * (w - pad * 2);
      const y = h - pad - ((v - minY) / (maxY - minY)) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };

    const bestPts = convPoints.map((p, i) => toXY(i, p.best)).join(" ");
    const curPts = convPoints.map((p, i) => toXY(i, p.current)).join(" ");

    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-48 bg-ink-950 rounded-lg border border-ink-700"
      >
        <text x={pad} y={16} className="fill-mist-300 text-[10px] font-mono">
          Simulated Annealing (5,000 iters) · Max Fitness: {maxY.toFixed(2)} | Start:{" "}
          {convPoints[0].current.toFixed(2)}
        </text>
        <polyline
          fill="none"
          stroke="#3B63E0"
          strokeWidth="1.2"
          strokeOpacity="0.55"
          points={curPts}
        />
        <polyline
          fill="none"
          stroke="#C9023E"
          strokeWidth="2.4"
          points={bestPts}
        />
        <text x={pad} y={h - 6} className="fill-mist-300 text-[10px] font-mono">
          0 evals
        </text>
        <text
          x={w - pad - 65}
          y={h - 6}
          className="fill-mist-300 text-[10px] font-mono"
        >
          {convPoints[convPoints.length - 1].evals} evals
        </text>
      </svg>
    );
  };

  // Prefer active current-season playersPool from /api/bootstrap so departed players are excluded
  const scatterSource: GMMPlayerPoint[] =
    playersPool && playersPool.length > 0
      ? playersPool
      : benchmarks?.gmm_players || [];

  const filteredScatter = scatterSource.filter(
    (p) =>
      p.position === posFilter &&
      p.status !== "u" &&
      !p.low_sample &&
      p.archetype &&
      p.archetype !== "Unclassified"
  );

  const ARCHETYPE_COLORS = [
    "#C9023E",
    "#3B63E0",
    "#74CBE9",
    "#E2A64A",
    "#A9A5C6",
    "#FF5470",
  ];
  const uniqueArchetypes = Array.from(
    new Set(filteredScatter.map((p) => p.archetype))
  );

  const renderScatterSvg = () => {
    if (filteredScatter.length === 0) {
      return (
        <div className="bg-ink-950 rounded-lg border border-ink-700 text-xs text-mist-300 py-8 px-4 text-center">
          No active current-season archetype points for {posFilter}.
        </div>
      );
    }
    const w = 520;
    const h = 190;
    const pad = 28;
    const xs = filteredScatter.map((p) => p.defcon_hit_rate ?? 0);
    const ys = filteredScatter.map((p) => (p.xg_per90 ?? 0) + (p.xa_per90 ?? 0));
    const maxX = Math.max(...xs, 0.2);
    const maxY = Math.max(...ys, 0.2);

    return (
      <div className="flex flex-col gap-2">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full h-48 bg-ink-950 rounded-lg border border-ink-700"
        >
          <text x={pad} y={16} className="fill-mist-300 text-[10px] font-mono">
            Active {posFilter}s ({filteredScatter.length}) · Y: xG+xA/90 (max{" "}
            {maxY.toFixed(2)}) vs X: DefCon Hit Rate (max {(maxX * 100).toFixed(0)}%)
          </text>
          {filteredScatter.map((p) => {
            const xVal = p.defcon_hit_rate ?? 0;
            const yVal = (p.xg_per90 ?? 0) + (p.xa_per90 ?? 0);
            const cx = pad + (xVal / maxX) * (w - pad * 2);
            const cy = h - pad - (yVal / maxY) * (h - pad * 2);
            const cIdx = uniqueArchetypes.indexOf(p.archetype);
            const color = ARCHETYPE_COLORS[cIdx % ARCHETYPE_COLORS.length];
            const price = p.price ?? p.cost ?? 5.0;
            return (
              <circle
                key={p.element}
                cx={cx}
                cy={cy}
                r={Math.max(3.5, (price - 3.5) * 0.9)}
                fill={color}
                fillOpacity={0.82}
              >
                <title>
                  {p.name} ({p.team_short || p.position}, £{price.toFixed(1)}m) ·{" "}
                  {p.archetype} | DefCon: {((p.defcon_hit_rate ?? 0) * 100).toFixed(1)}%
                  | xGI/90: {yVal.toFixed(2)}
                </title>
              </circle>
            );
          })}
        </svg>
        <div className="flex flex-wrap gap-3 text-[11px]">
          {uniqueArchetypes.map((arch, idx) => (
            <span key={arch} className="flex items-center gap-1.5 text-mist-300">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{
                  backgroundColor:
                    ARCHETYPE_COLORS[idx % ARCHETYPE_COLORS.length],
                }}
              />
              {arch}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-ink-900 border border-ink-700 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 border-b border-ink-700 pb-2.5">
        <TrendUp
          size={16}
          weight="bold"
          className="text-crimson-400 shrink-0"
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-mist-50">
          Analytics, Active-Season GMM Tactical Archetypes & Offline Benchmarks
        </h2>
      </div>

      {/* Top Row: Convergence Curve + GMM Scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-mist-300">
            <TrendUp
              size={14}
              weight="bold"
              className="text-spark-400 shrink-0"
              aria-hidden="true"
            />
            <span>
              Simulated Annealing Convergence:{" "}
              <span className="text-crimson-400">Best (Crimson)</span> vs{" "}
              <span className="text-cobalt-400">Current (Cobalt)</span>
            </span>
          </div>
          {renderConvergenceSvg()}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-mist-300">
              <ChartScatter
                size={14}
                weight="bold"
                className="text-cobalt-400 shrink-0"
                aria-hidden="true"
              />
              <span>
                GMM + BIC Tactical Archetype Scatter (Active Current-Season Players)
              </span>
            </span>
            <div className="flex gap-1 text-[11px]">
              {["DEF", "MID", "FWD"].map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setPosFilter(pos)}
                  className={`px-2.5 py-0.5 rounded-md font-mono whitespace-nowrap transition active:scale-[0.98] cursor-pointer ${
                    posFilter === pos
                      ? "bg-cobalt-500 text-mist-50 font-bold"
                      : "bg-ink-800 hover:bg-ink-700 text-mist-300 font-semibold"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
          {renderScatterSvg()}
        </div>
      </div>

      {/* Bottom Row: Benchmark Tables from experiments.py */}
      {benchmarks && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
          <div className="bg-ink-950 border border-ink-700 rounded-xl p-3.5 overflow-x-auto">
            <div className="font-bold text-mist-50 mb-2">
              Optimizer Benchmark (30 Seeds, 5,000 Evals)
            </div>
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="text-mist-300 border-b border-ink-700">
                  <th className="py-1.5 pr-2">Agent</th>
                  <th className="py-1.5 pr-2">Mean F(S)</th>
                  <th className="py-1.5 pr-2">Std</th>
                  <th className="py-1.5">Best</th>
                </tr>
              </thead>
              <tbody>
                {(benchmarks.optimizer?.summary || []).map((row: any) => (
                  <tr
                    key={row.agent}
                    className="border-b border-ink-800/80 last:border-b-0"
                  >
                    <td className="py-1.5 pr-2 text-mist-50">{row.agent}</td>
                    <td className="py-1.5 pr-2 text-spark-400 font-bold">
                      {Number(row.mean_fitness).toFixed(2)}
                    </td>
                    <td className="py-1.5 pr-2 text-mist-300">
                      {Number(row.std_fitness).toFixed(2)}
                    </td>
                    <td className="py-1.5 text-cobalt-400">
                      {Number(row.best_fitness).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-ink-950 border border-ink-700 rounded-xl p-3.5 overflow-x-auto">
            <div className="font-bold text-mist-50 mb-2">
              Chronological ML Validation (2025-26)
            </div>
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="text-mist-300 border-b border-ink-700">
                  <th className="py-1.5 pr-2">Model</th>
                  <th className="py-1.5 pr-2">Subset</th>
                  <th className="py-1.5 pr-2">RMSE</th>
                  <th className="py-1.5 pr-2">MAE</th>
                  <th className="py-1.5">R²</th>
                </tr>
              </thead>
              <tbody>
                {(benchmarks.ml?.regression || []).map((row: any, i: number) => (
                  <tr
                    key={i}
                    className="border-b border-ink-800/80 last:border-b-0"
                  >
                    <td className="py-1.5 pr-2 text-mist-50">{row.model}</td>
                    <td className="py-1.5 pr-2 text-mist-300">{row.subset}</td>
                    <td className="py-1.5 pr-2 text-spark-400 font-bold">
                      {Number(row.rmse).toFixed(3)}
                    </td>
                    <td className="py-1.5 pr-2 text-mist-300">
                      {Number(row.mae).toFixed(3)}
                    </td>
                    <td className="py-1.5 text-cobalt-400">
                      {Number(row.r2).toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {benchmarks.ml?.defcon && (
              <div className="mt-2.5 pt-2 border-t border-ink-800/80 text-[11px] font-mono text-mist-300">
                DefCon Classifier ROC-AUC:{" "}
                <strong className="text-spark-400">
                  {Number(benchmarks.ml.defcon.auc).toFixed(3)}
                </strong>{" "}
                | Brier:{" "}
                <strong className="text-cobalt-400">
                  {Number(benchmarks.ml.defcon.brier).toFixed(4)}
                </strong>
              </div>
            )}
          </div>

          <div className="bg-ink-950 border border-ink-700 rounded-xl p-3.5 overflow-x-auto">
            <div className="font-bold text-mist-50 mb-2">
              38-GW Season Backtest (Realised FPL Points)
            </div>
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="text-mist-300 border-b border-ink-700">
                  <th className="py-1.5 pr-2">Agent</th>
                  <th className="py-1.5 pr-2">Total Pts</th>
                  <th className="py-1.5 pr-2">Pts/GW</th>
                  <th className="py-1.5">Best GW</th>
                </tr>
              </thead>
              <tbody>
                {(benchmarks.backtest?.summary || []).map((row: any) => (
                  <tr
                    key={row.agent}
                    className="border-b border-ink-800/80 last:border-b-0"
                  >
                    <td className="py-1.5 pr-2 text-mist-50">{row.agent}</td>
                    <td className="py-1.5 pr-2 text-spark-400 font-bold">
                      {Number(row.total_points).toFixed(0)}
                    </td>
                    <td className="py-1.5 pr-2 text-mist-300">
                      {Number(row.mean_gw_points).toFixed(1)}
                    </td>
                    <td className="py-1.5 text-cobalt-400">
                      {Number(row.best_gw).toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
