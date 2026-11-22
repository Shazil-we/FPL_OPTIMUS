"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsLeftRight,
  ShieldCheck,
} from "@phosphor-icons/react";
import type { WorkflowDataset } from "../../lib/workflowTypes";

export interface BacktestClosingSectionProps {
  backtest: WorkflowDataset["backtest"];
}

type BacktestAgentKey = "sa" | "hc" | "random" | "greedy";

const SERIES_META: Record<
  BacktestAgentKey,
  {
    label: string;
    summaryAgent: string;
    color: string;
    gwField: "saGwPts" | "hcGwPts" | "randomGwPts" | "greedyGwPts";
  }
> = {
  sa: {
    label: "SimulatedAnnealing",
    summaryAgent: "SimulatedAnnealing",
    color: "#C9023E",
    gwField: "saGwPts",
  },
  hc: {
    label: "HillClimbing",
    summaryAgent: "HillClimbing",
    color: "#74CBE9",
    gwField: "hcGwPts",
  },
  random: {
    label: "Random",
    summaryAgent: "Random",
    color: "#6C8CF0",
    gwField: "randomGwPts",
  },
  greedy: {
    label: "Greedy",
    summaryAgent: "Greedy",
    color: "#E2A64A",
    gwField: "greedyGwPts",
  },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 38-gameweek season backtest visualization, Transfer Studio rules, closing CTA band, and footer.
 */
export function BacktestClosingSection({
  backtest,
}: BacktestClosingSectionProps) {
  const [visibleAgents, setVisibleAgents] = useState<
    Record<BacktestAgentKey, boolean>
  >({
    sa: true,
    hc: true,
    random: true,
    greedy: true,
  });
  const [hoverGwIdx, setHoverGwIdx] = useState<number | null>(null);

  const toggleAgent = (key: BacktestAgentKey) => {
    setVisibleAgents((prev) => {
      const count = Object.values(prev).filter(Boolean).length;
      if (prev[key] && count <= 1) return prev;
      return { ...prev, [key]: !prev[key] };
    });
  };

  const stats = useMemo(() => {
    const byAgent = new Map(backtest.summary.map((s) => [s.agent, s]));
    const sa = byAgent.get("SimulatedAnnealing");
    const hc = byAgent.get("HillClimbing");
    const greedy = byAgent.get("Greedy");

    const saTotal = sa?.totalPoints ?? 2231;
    const hcTotal = hc?.totalPoints ?? 2171;
    const greedyTotal = greedy?.totalPoints ?? 2084;
    const saMean = sa?.meanGwPoints ?? 58.71;

    return {
      saTotal,
      vsHc: Math.round(saTotal - hcTotal),
      vsGreedy: Math.round(saTotal - greedyTotal),
      saMean,
    };
  }, [backtest.summary]);

  const chart = useMemo(() => {
    const rows = backtest.trajectory;
    const w = 920;
    const h = 330;
    const pad = { top: 24, right: 64, bottom: 40, left: 56 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const activeKeys = (
      Object.keys(SERIES_META) as BacktestAgentKey[]
    ).filter((k) => visibleAgents[k]);

    const vals = rows.flatMap((r) => activeKeys.map((k) => r[k]));
    const minY = 0;
    const maxY = vals.length
      ? Math.ceil((Math.max(...vals) + 100) / 200) * 200
      : 2400;

    const xOf = (idx: number) =>
      pad.left + (idx / Math.max(rows.length - 1, 1)) * iw;
    const yOf = (v: number) =>
      pad.top + ih - ((v - minY) / Math.max(maxY - minY, 1)) * ih;

    const yTicks: number[] = [];
    const step = maxY / 4;
    for (let i = 0; i <= 4; i++) {
      yTicks.push(Math.round(i * step));
    }

    // Compute clean terminal label Y offsets so close final totals never collide
    const lastRow = rows[rows.length - 1];
    const terminalLabels = lastRow
      ? activeKeys
          .map((k) => ({
            key: k,
            value: lastRow[k],
            y: yOf(lastRow[k]),
            color: SERIES_META[k].color,
          }))
          .sort((a, b) => a.y - b.y)
      : [];

    for (let i = 1; i < terminalLabels.length; i++) {
      if (terminalLabels[i].y - terminalLabels[i - 1].y < 14) {
        terminalLabels[i].y = terminalLabels[i - 1].y + 14;
      }
    }

    return {
      w,
      h,
      pad,
      iw,
      ih,
      rows,
      activeKeys,
      minY,
      maxY,
      xOf,
      yOf,
      yTicks,
      terminalLabels,
    };
  }, [backtest.trajectory, visibleAgents]);

  const activeIdx =
    hoverGwIdx !== null && chart.rows[hoverGwIdx]
      ? hoverGwIdx
      : chart.rows.length > 0
      ? chart.rows.length - 1
      : null;

  const activeRow = activeIdx !== null ? chart.rows[activeIdx] : null;

  return (
    <section
      id="backtest"
      aria-labelledby="backtest-heading"
      className="pt-20 pb-12 px-4 sm:px-6 max-w-7xl mx-auto w-full"
    >
      {/* Stacked section header with ONLY BacktestClosingSection eyebrow */}
      <div className="max-w-[65ch]">
        <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-crimson-400">
          EMPIRICAL SEASON VALIDATION
        </p>
        <h2
          id="backtest-heading"
          className="mt-2 font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50"
        >
          38 Gameweeks of Out-of-Sample Play
        </h2>
        <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed">
          Strict pre-kickoff predictions evaluated across a full 2025-26
          campaign with weekly free transfers, captaincy, and auto-substitutions.
        </p>
      </div>

      {/* Full-width 38-GW Cumulative Realised Points Chart */}
      <div className="mt-10 rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6 min-w-0">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-mist-50">
              Cumulative Realised FPL Points (GW1 to GW38)
            </h3>
            <p className="mt-0.5 text-xs text-mist-300">
              Toggle agents or hover across gameweeks to inspect cumulative
              totals and Simulated Annealing captaincy.
            </p>
          </div>

          <div
            role="group"
            aria-label="Toggle backtest agents"
            className="flex flex-wrap items-center gap-1.5"
          >
            {(Object.keys(SERIES_META) as BacktestAgentKey[]).map((key) => {
              const active = visibleAgents[key];
              const meta = SERIES_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleAgent(key)}
                  className={[
                    "rounded-full px-3 py-1.5 text-[11px] font-mono font-semibold border transition-colors cursor-pointer inline-flex items-center gap-1.5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                    active
                      ? "border-ink-700 bg-ink-800 text-mist-50"
                      : "border-ink-700/60 bg-ink-950 text-mist-300 opacity-50 hover:opacity-85",
                  ].join(" ")}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Hover Readout Strip */}
        <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-950/90 px-3.5 py-2.5 text-xs font-mono tabular-nums">
          {activeRow ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-mist-50 font-semibold">
                  GW {activeRow.gw}
                </span>
                <span className="text-mist-300">
                  SA GW Pts:{" "}
                  <strong className="text-crimson-400">
                    {activeRow.saGwPts}
                  </strong>
                </span>
                <span className="text-mist-300">
                  SA Captain:{" "}
                  <strong className="text-spark-400">
                    {activeRow.saCaptain}
                  </strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mist-300">
                {chart.activeKeys.map((key) => (
                  <span key={key} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: SERIES_META[key].color }}
                    />
                    {SERIES_META[key].label}{" "}
                    <strong className="text-mist-50">
                      {activeRow[key].toLocaleString("en-US")}
                    </strong>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className="text-mist-300">
              Hover over the chart to inspect gameweek totals and captain picks.
            </span>
          )}
        </div>

        {/* Cumulative Trajectory SVG */}
        <div className="rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden">
          <svg
            viewBox={`0 0 ${chart.w} ${chart.h}`}
            role="img"
            aria-label="38-gameweek cumulative realised FPL points line chart comparing SimulatedAnnealing, HillClimbing, Random, and Greedy"
            className="w-full h-auto block select-none"
          >
            {chart.yTicks.map((t) => {
              const y = chart.yOf(t);
              return (
                <g key={t}>
                  <line
                    x1={chart.pad.left}
                    x2={chart.w - chart.pad.right}
                    y1={y}
                    y2={y}
                    stroke="#2A2F52"
                    strokeDasharray="3 4"
                    strokeWidth={1}
                  />
                  <text
                    x={chart.pad.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    {t.toLocaleString("en-US")}
                  </text>
                </g>
              );
            })}

            {/* X-axis gameweek ticks */}
            {chart.rows
              .filter((r) => [1, 6, 12, 18, 24, 30, 38].includes(r.gw))
              .map((r) => {
                const idx = chart.rows.indexOf(r);
                const x = chart.xOf(idx);
                return (
                  <text
                    key={r.gw}
                    x={x}
                    y={chart.h - 14}
                    textAnchor="middle"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    GW{r.gw}
                  </text>
                );
              })}

            <text
              x={14}
              y={chart.pad.top + chart.ih / 2}
              transform={`rotate(-90 14 ${chart.pad.top + chart.ih / 2})`}
              textAnchor="middle"
              className="fill-mist-300 text-[10px] font-mono"
            >
              Cumulative Points
            </text>

            {/* Agent lines */}
            {(["greedy", "random", "hc", "sa"] as BacktestAgentKey[]).map(
              (key) => {
                if (!visibleAgents[key] || chart.rows.length === 0) return null;
                const pts = chart.rows
                  .map(
                    (r, i) =>
                      `${chart.xOf(i).toFixed(1)},${chart
                        .yOf(r[key])
                        .toFixed(1)}`
                  )
                  .join(" ");
                return (
                  <polyline
                    key={key}
                    fill="none"
                    stroke={SERIES_META[key].color}
                    strokeWidth={key === "sa" ? 2.8 : 1.9}
                    strokeLinejoin="round"
                    points={pts}
                  />
                );
              }
            )}

            {/* Terminal cumulative score labels */}
            {chart.terminalLabels.map((lbl) => (
              <text
                key={lbl.key}
                x={chart.w - chart.pad.right + 8}
                y={lbl.y + 3.5}
                textAnchor="start"
                className="text-[10px] font-mono font-semibold"
                fill={lbl.color}
              >
                {lbl.value.toLocaleString("en-US")}
              </text>
            ))}

            {/* Hover vertical guide & dots */}
            {activeIdx !== null && activeRow && (
              <g aria-hidden="true">
                <line
                  x1={chart.xOf(activeIdx)}
                  x2={chart.xOf(activeIdx)}
                  y1={chart.pad.top}
                  y2={chart.pad.top + chart.ih}
                  stroke="#EEEAF4"
                  strokeOpacity={0.38}
                  strokeWidth={1.1}
                />
                {chart.activeKeys.map((key) => (
                  <circle
                    key={key}
                    cx={chart.xOf(activeIdx)}
                    cy={chart.yOf(activeRow[key])}
                    r={key === "sa" ? 4.8 : 3.6}
                    fill={SERIES_META[key].color}
                    stroke={key === "sa" ? "#EEEAF4" : "#0A0C18"}
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            )}

            <rect
              x={chart.pad.left}
              y={chart.pad.top}
              width={chart.iw}
              height={chart.ih}
              fill="transparent"
              className="cursor-crosshair"
              onPointerMove={(e) => {
                if (!chart.rows.length) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const rel = clamp(
                  (e.clientX - rect.left) / Math.max(rect.width, 1),
                  0,
                  1
                );
                setHoverGwIdx(Math.round(rel * (chart.rows.length - 1)));
              }}
              onPointerLeave={() => setHoverGwIdx(null)}
            />
          </svg>
        </div>
      </div>

      {/* 4 Typographic Stat Highlights separated by hairlines (NO cards) */}
      <div className="mt-8 border-y border-ink-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <div className="py-5 sm:pr-6 border-b sm:border-r lg:border-b-0 border-ink-700">
          <div className="text-xs font-mono text-mist-300">
            Total Season Points
          </div>
          <div className="mt-1 font-display text-4xl font-bold text-mist-50 tabular-nums">
            {stats.saTotal.toLocaleString("en-US")}
          </div>
          <div className="mt-1 text-xs text-mist-300">
            Simulated Annealing across GW1 to GW38
          </div>
        </div>

        <div className="py-5 sm:pl-6 lg:px-6 border-b lg:border-b-0 lg:border-r border-ink-700">
          <div className="text-xs font-mono text-mist-300">
            vs Hill Climbing
          </div>
          <div className="mt-1 font-display text-4xl font-bold text-crimson-400 tabular-nums">
            +{stats.vsHc} pts
          </div>
          <div className="mt-1 text-xs text-mist-300">
            Outperforms steepest-ascent local search
          </div>
        </div>

        <div className="py-5 sm:pr-6 lg:px-6 border-b sm:border-b-0 sm:border-r border-ink-700">
          <div className="text-xs font-mono text-mist-300">
            vs Greedy Value
          </div>
          <div className="mt-1 font-display text-4xl font-bold text-spark-400 tabular-nums">
            +{stats.vsGreedy} pts
          </div>
          <div className="mt-1 text-xs text-mist-300">
            Beats constructive xP/price baseline
          </div>
        </div>

        <div className="py-5 sm:pl-6">
          <div className="text-xs font-mono text-mist-300">
            Mean Points per GW
          </div>
          <div className="mt-1 font-display text-4xl font-bold text-mist-50 tabular-nums">
            {stats.saMean.toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-mist-300">
            Strict out-of-sample weekly execution
          </div>
        </div>
      </div>

      {/* Concise Transfer Studio Summary */}
      <div className="mt-6 rounded-xl border border-ink-700/80 bg-ink-950/75 px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 text-mist-50">
          <ArrowsLeftRight
            size={18}
            weight="bold"
            aria-hidden="true"
            className="text-crimson-400 shrink-0 mt-0.5 sm:mt-0"
          />
          <span className="text-xs sm:text-sm font-semibold">
            Transfer Studio Horizon Rules
          </span>
        </div>
        <p className="text-xs sm:text-sm text-mist-300 leading-relaxed">
          Supports 1 to 5 banked free transfers, evaluates net -4 pt hit
          trade-offs beyond free allowance, and optimizes both 1-GW Freehit and
          5-GW Wildcard horizons.
        </p>
      </div>

      {/* Closing Action Band */}
      <div
        className="mt-16 rounded-2xl border border-ink-700 bg-ink-950 relative overflow-hidden p-8 sm:p-12"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 65% 75% at 50% 0%, rgba(201, 2, 62, 0.22), transparent 72%)",
        }}
      >
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-spark-400">
            <ShieldCheck size={15} weight="bold" aria-hidden="true" />
            <span>Hard FPL Constraints Enforced</span>
          </div>
          <h2 className="mt-3 font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50">
            Put the Pipeline Behind Your Next Transfer
          </h2>
          <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed max-w-[54ch]">
            Inspect live expected points, calibrated DefCon probabilities, and
            constrained transfer plans in the interactive workspace.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/app"
              className="rounded-full bg-crimson-500 hover:bg-crimson-400 text-mist-50 px-6 py-3 text-sm font-semibold inline-flex items-center gap-2 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
            >
              <span>Launch Optimizer</span>
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="rounded-full border border-ink-700 bg-ink-900 hover:border-cobalt-400 text-mist-300 hover:text-mist-50 px-5 py-3 text-sm font-medium inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
            >
              <ArrowLeft size={15} weight="bold" aria-hidden="true" />
              <span>Back to Overview</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Minimal Single-Row Footer */}
      <footer className="mt-12 pt-6 border-t border-ink-700/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-mist-300">
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <span className="font-display text-base font-bold uppercase tracking-tight text-mist-50">
            FPL-Optimus
          </span>
          <span className="text-mist-300">
            | Machine Learning and Local Search Squad Optimizer
          </span>
        </div>
        <div className="font-mono text-mist-300">
          Data sources: Official FPL API and Vaastav FPL Historical Dataset
        </div>
      </footer>
    </section>
  );
}

export default BacktestClosingSection;
