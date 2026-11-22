"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowCounterClockwise,
  Flame,
  Pause,
  Play,
} from "@phosphor-icons/react";
import type { OptimizerRunDot, WorkflowDataset } from "../../lib/workflowTypes";
import { MathDisclosure } from "./MathDisclosure";

export interface AnnealingTheaterSectionProps {
  optimizer: WorkflowDataset["optimizer"];
}

type CompareTab = "convergence" | "distribution";

const AGENT_COLORS: Record<string, string> = {
  SimulatedAnnealing: "#C9023E",
  HillClimbing: "#74CBE9",
  "HillClimbing (no restart)": "#E2A64A",
  Random: "#6C8CF0",
  Greedy: "#A9A5C6",
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Interactive scrubbable Simulated Annealing replay theater and 30-seed solver comparison.
 */
export function AnnealingTheaterSection({
  optimizer,
}: AnnealingTheaterSectionProps) {
  const trace = optimizer.saTrace;
  const maxStep = Math.max(trace.length - 1, 0);

  const [stepIndex, setStepIndex] = useState<number>(maxStep);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isScrubbingSvg, setIsScrubbingSvg] = useState<boolean>(false);
  const [compareTab, setCompareTab] = useState<CompareTab>("convergence");
  const [hoverEvalIdx, setHoverEvalIdx] = useState<number | null>(null);
  const [hoveredDot, setHoveredDot] = useState<OptimizerRunDot | null>(null);

  const reduceMotion = useReducedMotion();
  const scrubberId = useId();
  const tabLayoutId = useId();

  useEffect(() => {
    setStepIndex(Math.max(trace.length - 1, 0));
  }, [trace.length]);

  useEffect(() => {
    if (!isPlaying || maxStep <= 0) return;
    const intervalMs = reduceMotion ? 90 : 45;
    const id = window.setInterval(() => {
      setStepIndex((prev) => {
        if (prev >= maxStep) {
          setIsPlaying(false);
          return maxStep;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [isPlaying, maxStep, reduceMotion]);

  const handleTogglePlay = () => {
    if (maxStep <= 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (stepIndex >= maxStep) {
      setStepIndex(0);
    }
    setIsPlaying(true);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setStepIndex(0);
  };

  const activePoint = trace[clamp(stepIndex, 0, maxStep)] ?? {
    step: 0,
    iter: 0,
    temperature: 10.0,
    current: 0,
    best: 0,
  };

  const metropolisAcceptPct = useMemo(() => {
    const temp = Math.max(activePoint.temperature, 1e-9);
    const prob = Math.exp(-0.5 / temp) * 100;
    return clamp(prob, 0, 100);
  }, [activePoint.temperature]);

  const saSummary = useMemo(
    () => optimizer.summary.find((s) => s.agent === "SimulatedAnnealing"),
    [optimizer.summary]
  );

  const hcSummary = useMemo(
    () => optimizer.summary.find((s) => s.agent === "HillClimbing"),
    [optimizer.summary]
  );

  const greedySummary = useMemo(
    () => optimizer.summary.find((s) => s.agent === "Greedy"),
    [optimizer.summary]
  );

  const phaseLabel = useMemo(() => {
    if (activePoint.temperature > 0.25) {
      return "Early Exploration: escapes £0.0m bank traps";
    }
    if (activePoint.temperature >= 0.01) {
      return "Cooling Transition: balances 2-swap shifts and local climbs";
    }
    return `Late Exploitation: converges to ${activePoint.best.toFixed(2)} (30-seed peak ${(
      saSummary?.bestFitness ?? 69.35
    ).toFixed(2)})`;
  }, [activePoint.temperature, activePoint.best, saSummary]);

  // Dual-axis SA Replay SVG geometry
  const replayGeom = useMemo(() => {
    const w = 880;
    const h = 300;
    const pad = { top: 22, right: 56, bottom: 38, left: 52 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const fVals =
      trace.length > 0 ? trace.flatMap((p) => [p.current, p.best]) : [0, 70];
    const minF = Math.floor(Math.min(...fVals) / 5) * 5;
    const maxF = Math.ceil((Math.max(...fVals) + 2) / 5) * 5;
    const maxT =
      trace.length > 0 ? Math.max(...trace.map((p) => p.temperature), 10) : 10;

    const xOf = (idx: number) =>
      pad.left + (idx / Math.max(trace.length - 1, 1)) * iw;
    const yF = (f: number) =>
      pad.top + ih - ((f - minF) / Math.max(maxF - minF, 1)) * ih;
    const yT = (t: number) =>
      pad.top + ih - (clamp(t, 0, maxT) / Math.max(maxT, 1)) * ih;

    const fullBest = trace
      .map((p, i) => `${xOf(i).toFixed(1)},${yF(p.best).toFixed(1)}`)
      .join(" ");
    const fullCurrent = trace
      .map((p, i) => `${xOf(i).toFixed(1)},${yF(p.current).toFixed(1)}`)
      .join(" ");
    const fullTemp = trace
      .map((p, i) => `${xOf(i).toFixed(1)},${yT(p.temperature).toFixed(1)}`)
      .join(" ");

    const activeSlice = trace.slice(0, clamp(stepIndex, 0, maxStep) + 1);
    const activeBest = activeSlice
      .map((p, i) => `${xOf(i).toFixed(1)},${yF(p.best).toFixed(1)}`)
      .join(" ");
    const activeCurrent = activeSlice
      .map((p, i) => `${xOf(i).toFixed(1)},${yF(p.current).toFixed(1)}`)
      .join(" ");
    const activeTemp = activeSlice
      .map((p, i) => `${xOf(i).toFixed(1)},${yT(p.temperature).toFixed(1)}`)
      .join(" ");

    const yTicksF: number[] = [];
    const stepF = (maxF - minF) / 4;
    for (let i = 0; i <= 4; i++) {
      yTicksF.push(Math.round(minF + stepF * i));
    }

    return {
      w,
      h,
      pad,
      iw,
      ih,
      minF,
      maxF,
      maxT,
      xOf,
      yF,
      yT,
      fullBest,
      fullCurrent,
      fullTemp,
      activeBest,
      activeCurrent,
      activeTemp,
      yTicksF,
    };
  }, [trace, stepIndex, maxStep]);

  const scrubFromClientX = (
    rect: DOMRect,
    clientX: number
  ) => {
    if (maxStep <= 0) return;
    const rel = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    setIsPlaying(false);
    setStepIndex(Math.round(rel * maxStep));
  };

  // Convergence curve SVG geometry
  const convGeom = useMemo(() => {
    const w = 880;
    const h = 300;
    const pad = { top: 22, right: 26, bottom: 38, left: 52 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const seriesKeys = Object.keys(optimizer.convergenceMeanBest).filter(
      (k) => (optimizer.convergenceMeanBest[k]?.length ?? 0) > 1
    );
    const allVals = seriesKeys.flatMap(
      (k) => optimizer.convergenceMeanBest[k] ?? []
    );
    const greedyRef = greedySummary?.meanFitness ?? 64.1;
    if (allVals.length > 0) allVals.push(greedyRef);

    const minY = allVals.length
      ? Math.floor(Math.min(...allVals) / 5) * 5
      : 15;
    const maxY = allVals.length
      ? Math.ceil((Math.max(...allVals) + 2) / 5) * 5
      : 75;
    const maxPoints = Math.max(
      ...seriesKeys.map((k) => optimizer.convergenceMeanBest[k].length),
      2
    );

    const xOf = (idx: number) =>
      pad.left + (idx / Math.max(maxPoints - 1, 1)) * iw;
    const yOf = (v: number) =>
      pad.top + ih - ((v - minY) / Math.max(maxY - minY, 1)) * ih;

    const yTicks: number[] = [];
    const step = (maxY - minY) / 4;
    for (let i = 0; i <= 4; i++) {
      yTicks.push(Math.round(minY + step * i));
    }

    return {
      w,
      h,
      pad,
      iw,
      ih,
      seriesKeys,
      greedyRef,
      minY,
      maxY,
      maxPoints,
      xOf,
      yOf,
      yTicks,
    };
  }, [optimizer.convergenceMeanBest, greedySummary]);

  const activeConvIdx =
    hoverEvalIdx !== null
      ? clamp(hoverEvalIdx, 0, convGeom.maxPoints - 1)
      : convGeom.maxPoints - 1;

  // 30-seed distribution SVG geometry
  const distGeom = useMemo(() => {
    const w = 880;
    const h = 300;
    const pad = { top: 20, right: 24, bottom: 38, left: 195 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const orderedAgents = [...optimizer.summary]
      .sort((a, b) => b.meanFitness - a.meanFitness)
      .map((s) => s.agent);

    const allDots = optimizer.runsBySeed;
    const allFitness = allDots.map((d) => d.fitness);
    const minX = allFitness.length
      ? Math.floor((Math.min(...allFitness) - 1) / 5) * 5
      : 40;
    const maxX = allFitness.length
      ? Math.ceil((Math.max(...allFitness) + 1) / 5) * 5
      : 72;

    const xOf = (f: number) =>
      pad.left + ((f - minX) / Math.max(maxX - minX, 1)) * iw;
    const rowStep = ih / Math.max(orderedAgents.length, 1);
    const yCenter = (rowIdx: number) => pad.top + rowStep * (rowIdx + 0.5);

    const rows = orderedAgents.map((agent, rowIdx) => {
      const dots = allDots.filter((d) => d.agent === agent);
      const sorted = [...dots.map((d) => d.fitness)].sort((a, b) => a - b);
      const q1 = quantileSorted(sorted, 0.25);
      const med = quantileSorted(sorted, 0.5);
      const q3 = quantileSorted(sorted, 0.75);
      const summary = optimizer.summary.find((s) => s.agent === agent);
      return {
        agent,
        rowIdx,
        y: yCenter(rowIdx),
        dots,
        q1,
        med,
        q3,
        min: sorted[0] ?? summary?.worstFitness ?? 0,
        max: sorted[sorted.length - 1] ?? summary?.bestFitness ?? 0,
        summary,
      };
    });

    const xTicks: number[] = [];
    for (let v = minX; v <= maxX; v += 5) {
      xTicks.push(v);
    }

    return { w, h, pad, iw, ih, minX, maxX, xOf, rows, xTicks };
  }, [optimizer.runsBySeed, optimizer.summary]);

  return (
    <section
      id="optimizer"
      aria-labelledby="optimizer-heading"
      className="py-20 px-4 sm:px-6 max-w-7xl mx-auto w-full"
    >
      {/* Stacked section header (ZERO eyebrow) */}
      <div className="max-w-[65ch]">
        <h2
          id="optimizer-heading"
          className="font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50"
        >
          Simulated Annealing Over 5,000 Evaluations
        </h2>
        <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed">
          Geometric cooling and mixed swap proposals escape local optima across
          15-man squad selection under hard Fantasy Premier League rules.
        </p>
      </div>

      {/* Top Module: Interactive Scrubbable SA Replay Theater */}
      <div className="mt-10 rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6 min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-mist-50">
              <Flame
                size={18}
                weight="bold"
                aria-hidden="true"
                className="text-crimson-400 shrink-0"
              />
              <h3 className="text-sm font-semibold tracking-tight">
                Interactive Annealing Replay Theater (GW{optimizer.gameweek})
              </h3>
            </div>
            <p className="mt-1 text-xs font-mono text-spark-400">
              {phaseLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="rounded-full bg-crimson-500 hover:bg-crimson-400 text-mist-50 px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause size={14} weight="fill" aria-hidden="true" />
                  <span>Pause Replay</span>
                </>
              ) : (
                <>
                  <Play size={14} weight="fill" aria-hidden="true" />
                  <span>
                    {stepIndex >= maxStep ? "Replay from Iter 0" : "Play"}
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="rounded-full border border-ink-700 bg-ink-950 hover:bg-ink-800 text-mist-300 hover:text-mist-50 px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 cursor-pointer"
            >
              <ArrowCounterClockwise
                size={14}
                weight="bold"
                aria-hidden="true"
              />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Accessible scrubber slider with label ABOVE input */}
        <div className="mt-5 select-none">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label
              htmlFor={scrubberId}
              className="text-xs font-medium text-mist-300"
            >
              Annealing Trace Step Scrubber
            </label>
            <span className="text-xs font-mono font-semibold text-mist-50 tabular-nums">
              Step {stepIndex} / {maxStep} (Iter{" "}
              {activePoint.iter.toLocaleString("en-US")})
            </span>
          </div>
          <input
            id={scrubberId}
            type="range"
            min={0}
            max={maxStep}
            step={1}
            value={stepIndex}
            onChange={(e) => {
              setIsPlaying(false);
              setStepIndex(parseInt(e.target.value, 10));
            }}
            className="w-full h-1.5 rounded-full bg-ink-950 accent-crimson-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
          />
        </div>

        {/* Dual-axis SVG replay chart */}
        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden select-none">
          <svg
            viewBox={`0 0 ${replayGeom.w} ${replayGeom.h}`}
            role="img"
            aria-label="Dual-axis Simulated Annealing trace plotting Best F(S), Current F(S), and cooling Temperature T_k across 5,000 iterations"
            className="w-full h-auto block select-none"
          >
            {/* Gridlines & left Y-axis */}
            {replayGeom.yTicksF?.map((t) => {
              const y = replayGeom.yF ? replayGeom.yF(t) : replayGeom.pad.top;
              return (
                <g key={t}>
                  <line
                    x1={replayGeom.pad.left}
                    x2={replayGeom.w - replayGeom.pad.right}
                    y1={y}
                    y2={y}
                    stroke="#2A2F52"
                    strokeDasharray="3 4"
                    strokeWidth={1}
                  />
                  <text
                    x={replayGeom.pad.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    {t}
                  </text>
                </g>
              );
            })}

            {/* Right Y-axis ticks for Temperature T_k */}
            {[0, 2.5, 5, 7.5, 10].map((tVal) => {
              const y = replayGeom.yT ? replayGeom.yT(tVal) : replayGeom.pad.top;
              return (
                <text
                  key={tVal}
                  x={replayGeom.w - replayGeom.pad.right + 8}
                  y={y + 3.5}
                  textAnchor="start"
                  className="fill-spark-400 text-[10px] font-mono"
                >
                  {tVal.toFixed(1)}
                </text>
              );
            })}

            {/* X-axis ticks */}
            {[0, 1000, 2000, 3000, 4000, 5000].map((iterTick) => {
              const frac = iterTick / Math.max(optimizer.evalBudget, 1);
              const x = replayGeom.pad.left + frac * replayGeom.iw;
              return (
                <text
                  key={iterTick}
                  x={x}
                  y={replayGeom.h - 14}
                  textAnchor="middle"
                  className="fill-mist-300 text-[10px] font-mono"
                >
                  {iterTick.toLocaleString("en-US")}
                </text>
              );
            })}

            <text
              x={14}
              y={replayGeom.pad.top + replayGeom.ih / 2}
              transform={`rotate(-90 14 ${
                replayGeom.pad.top + replayGeom.ih / 2
              })`}
              textAnchor="middle"
              className="fill-mist-300 text-[10px] font-mono"
            >
              Fitness F(S)
            </text>
            <text
              x={replayGeom.w - 12}
              y={replayGeom.pad.top + replayGeom.ih / 2}
              transform={`rotate(90 ${replayGeom.w - 12} ${
                replayGeom.pad.top + replayGeom.ih / 2
              })`}
              textAnchor="middle"
              className="fill-spark-400 text-[10px] font-mono"
            >
              Temperature T_k
            </text>

            {/* Full preview ghost curves */}
            {replayGeom.fullTemp && (
              <polyline
                fill="none"
                stroke="#74CBE9"
                strokeOpacity={0.18}
                strokeDasharray="5 4"
                strokeWidth={1.3}
                points={replayGeom.fullTemp}
              />
            )}
            {replayGeom.fullCurrent && (
              <polyline
                fill="none"
                stroke="#6C8CF0"
                strokeOpacity={0.18}
                strokeWidth={1.3}
                points={replayGeom.fullCurrent}
              />
            )}
            {replayGeom.fullBest && (
              <polyline
                fill="none"
                stroke="#C9023E"
                strokeOpacity={0.2}
                strokeWidth={2}
                points={replayGeom.fullBest}
              />
            )}

            {/* Active replayed segments */}
            {replayGeom.activeTemp && (
              <polyline
                fill="none"
                stroke="#74CBE9"
                strokeDasharray="5 4"
                strokeWidth={1.7}
                points={replayGeom.activeTemp}
              />
            )}
            {replayGeom.activeCurrent && (
              <polyline
                fill="none"
                stroke="#6C8CF0"
                strokeOpacity={0.78}
                strokeWidth={1.6}
                points={replayGeom.activeCurrent}
              />
            )}
            {replayGeom.activeBest && (
              <polyline
                fill="none"
                stroke="#C9023E"
                strokeWidth={2.6}
                points={replayGeom.activeBest}
              />
            )}

            {/* Vertical playhead and marker dots */}
            {replayGeom.xOf && replayGeom.yF && replayGeom.yT && (
              <g aria-hidden="true">
                <line
                  x1={replayGeom.xOf(stepIndex)}
                  x2={replayGeom.xOf(stepIndex)}
                  y1={replayGeom.pad.top}
                  y2={replayGeom.pad.top + replayGeom.ih}
                  stroke="#EEEAF4"
                  strokeOpacity={0.45}
                  strokeWidth={1.2}
                />
                <circle
                  cx={replayGeom.xOf(stepIndex)}
                  cy={replayGeom.yT(activePoint.temperature)}
                  r={3.5}
                  fill="#74CBE9"
                  stroke="#0A0C18"
                  strokeWidth={1.4}
                />
                <circle
                  cx={replayGeom.xOf(stepIndex)}
                  cy={replayGeom.yF(activePoint.current)}
                  r={3.8}
                  fill="#6C8CF0"
                  stroke="#0A0C18"
                  strokeWidth={1.4}
                />
                <circle
                  cx={replayGeom.xOf(stepIndex)}
                  cy={replayGeom.yF(activePoint.best)}
                  r={4.8}
                  fill="#E5225A"
                  stroke="#EEEAF4"
                  strokeWidth={1.6}
                />
              </g>
            )}

            {/* Scrub capture rect */}
            <rect
              x={replayGeom.pad.left}
              y={replayGeom.pad.top}
              width={replayGeom.iw}
              height={replayGeom.ih}
              fill="transparent"
              className="cursor-ew-resize"
              onPointerDown={(e) => {
                setIsScrubbingSvg(true);
                scrubFromClientX(e.currentTarget.getBoundingClientRect(), e.clientX);
              }}
              onPointerMove={(e) => {
                if (!isScrubbingSvg) return;
                scrubFromClientX(e.currentTarget.getBoundingClientRect(), e.clientX);
              }}
              onPointerUp={() => setIsScrubbingSvg(false)}
              onPointerLeave={() => setIsScrubbingSvg(false)}
            />
          </svg>
        </div>

        {/* Series Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] font-mono text-mist-300">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 bg-crimson-500" />
            Best F(S)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 bg-cobalt-400" />
            Current F(S)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-0.5 w-4 border-t-2 border-dashed border-spark-400"
            />
            Temperature T_k (right axis)
          </span>
        </div>

        {/* Live Telemetry Strip synced to playhead */}
        <div className="mt-4 pt-4 border-t border-ink-700 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 font-mono tabular-nums">
          <div>
            <div className="text-[11px] text-mist-300">Iteration</div>
            <div className="mt-0.5 text-lg font-display font-bold text-mist-50">
              {activePoint.iter.toLocaleString("en-US")}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-mist-300">Temperature T_k</div>
            <div className="mt-0.5 text-lg font-display font-bold text-spark-400">
              {activePoint.temperature >= 0.01
                ? activePoint.temperature.toFixed(3)
                : activePoint.temperature.toFixed(4)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-mist-300">Current F(S)</div>
            <div className="mt-0.5 text-lg font-display font-bold text-cobalt-400">
              {activePoint.current.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-mist-300">Best F(S)</div>
            <div className="mt-0.5 text-lg font-display font-bold text-crimson-400">
              {activePoint.best.toFixed(2)}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <div className="text-[11px] text-mist-300">
              P(accept | delta=-0.5)
            </div>
            <div className="mt-0.5 text-lg font-display font-bold text-mist-50">
              {metropolisAcceptPct < 0.05 && metropolisAcceptPct > 0
                ? "< 0.1%"
                : `${metropolisAcceptPct.toFixed(1)}%`}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Module: 30-Seed Optimizer Comparison */}
      <div className="mt-6 rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-mist-50">
              {optimizer.runs}-Seed Optimizer Comparison (GW{optimizer.gameweek},{" "}
              {optimizer.evalBudget.toLocaleString("en-US")} Evals)
            </h3>
            <p className="mt-0.5 text-xs text-mist-300">
              Identical evaluation budget across {optimizer.runs} independent
              random seeds per heuristic.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Optimizer comparison view"
            className="inline-flex flex-wrap max-w-full items-center gap-1 rounded-2xl sm:rounded-full border border-ink-700 bg-ink-950 p-1 self-start sm:self-auto"
          >
            {(
              [
                { id: "convergence", label: "Convergence Curves" },
                { id: "distribution", label: "30-Seed Distribution" },
              ] as const
            ).map((tab) => {
              const selected = compareTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setCompareTab(tab.id)}
                  className={[
                    "relative rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                    selected
                      ? "text-mist-50"
                      : "text-mist-300 hover:text-mist-50",
                  ].join(" ")}
                >
                  {selected && (
                    <motion.span
                      layoutId={
                        reduceMotion ? undefined : `opt-tab-${tabLayoutId}`
                      }
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 420, damping: 34 }
                      }
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-crimson-500"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Convergence Curves View */}
        {compareTab === "convergence" && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-950/90 px-3.5 py-2 text-xs font-mono tabular-nums">
              <span className="text-mist-50 font-semibold">
                Eval{" "}
                {(
                  activeConvIdx * optimizer.convergenceEvalStep
                ).toLocaleString("en-US")}
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mist-300">
                {convGeom.seriesKeys.map((agent) => {
                  const arr = optimizer.convergenceMeanBest[agent] ?? [];
                  const val = arr[Math.min(activeConvIdx, arr.length - 1)];
                  return (
                    <span
                      key={agent}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: AGENT_COLORS[agent] ?? "#A9A5C6",
                        }}
                      />
                      {agent}{" "}
                      <strong className="text-mist-50">
                        {val !== undefined ? val.toFixed(2) : "n/a"}
                      </strong>
                    </span>
                  );
                })}
                <span>
                  Greedy ref{" "}
                  <strong className="text-mist-50">
                    {convGeom.greedyRef.toFixed(2)}
                  </strong>
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden">
              <svg
                viewBox={`0 0 ${convGeom.w} ${convGeom.h}`}
                role="img"
                aria-label="Mean best fitness convergence curves across 30 seeds from 0 to 5,000 evaluations"
                className="w-full h-auto block select-none"
              >
                {convGeom.yTicks.map((t) => {
                  const y = convGeom.yOf(t);
                  return (
                    <g key={t}>
                      <line
                        x1={convGeom.pad.left}
                        x2={convGeom.w - convGeom.pad.right}
                        y1={y}
                        y2={y}
                        stroke="#2A2F52"
                        strokeDasharray="3 4"
                        strokeWidth={1}
                      />
                      <text
                        x={convGeom.pad.left - 8}
                        y={y + 3.5}
                        textAnchor="end"
                        className="fill-mist-300 text-[10px] font-mono"
                      >
                        {t}
                      </text>
                    </g>
                  );
                })}

                {[0, 1000, 2000, 3000, 4000, 5000].map((evTick) => {
                  const idx = evTick / Math.max(optimizer.convergenceEvalStep, 1);
                  const x = convGeom.xOf(idx);
                  return (
                    <text
                      key={evTick}
                      x={x}
                      y={convGeom.h - 14}
                      textAnchor="middle"
                      className="fill-mist-300 text-[10px] font-mono"
                    >
                      {evTick.toLocaleString("en-US")}
                    </text>
                  );
                })}

                {/* Greedy single-shot reference line */}
                <line
                  x1={convGeom.pad.left}
                  x2={convGeom.w - convGeom.pad.right}
                  y1={convGeom.yOf(convGeom.greedyRef)}
                  y2={convGeom.yOf(convGeom.greedyRef)}
                  stroke="#A9A5C6"
                  strokeDasharray="6 4"
                  strokeWidth={1.3}
                />
                <text
                  x={convGeom.w - convGeom.pad.right - 4}
                  y={convGeom.yOf(convGeom.greedyRef) - 6}
                  textAnchor="end"
                  className="fill-mist-300 text-[10px] font-mono"
                >
                  GreedyValue ({convGeom.greedyRef.toFixed(2)})
                </text>

                {/* Convergence lines */}
                {convGeom.seriesKeys.map((agent) => {
                  const arr = optimizer.convergenceMeanBest[agent] ?? [];
                  const pts = arr
                    .map(
                      (v, i) =>
                        `${convGeom.xOf(i).toFixed(1)},${convGeom
                          .yOf(v)
                          .toFixed(1)}`
                    )
                    .join(" ");
                  return (
                    <polyline
                      key={agent}
                      fill="none"
                      stroke={AGENT_COLORS[agent] ?? "#A9A5C6"}
                      strokeWidth={agent === "SimulatedAnnealing" ? 2.6 : 1.9}
                      points={pts}
                    />
                  );
                })}

                {/* Hover vertical line */}
                <line
                  x1={convGeom.xOf(activeConvIdx)}
                  x2={convGeom.xOf(activeConvIdx)}
                  y1={convGeom.pad.top}
                  y2={convGeom.pad.top + convGeom.ih}
                  stroke="#EEEAF4"
                  strokeOpacity={0.35}
                  strokeWidth={1}
                />

                <rect
                  x={convGeom.pad.left}
                  y={convGeom.pad.top}
                  width={convGeom.iw}
                  height={convGeom.ih}
                  fill="transparent"
                  className="cursor-crosshair"
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const rel = clamp(
                      (e.clientX - rect.left) / Math.max(rect.width, 1),
                      0,
                      1
                    );
                    setHoverEvalIdx(
                      Math.round(rel * (convGeom.maxPoints - 1))
                    );
                  }}
                  onPointerLeave={() => setHoverEvalIdx(null)}
                />
              </svg>
            </div>
          </div>
        )}

        {/* 30-Seed Distribution View */}
        {compareTab === "distribution" && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-950/90 px-3.5 py-2 text-xs font-mono tabular-nums">
              {hoveredDot ? (
                <>
                  <span className="text-mist-50 font-semibold">
                    {hoveredDot.agent} | Seed {hoveredDot.seed}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mist-300">
                    <span>
                      Fitness{" "}
                      <strong className="text-crimson-400">
                        {hoveredDot.fitness.toFixed(2)}
                      </strong>
                    </span>
                    <span>
                      Evals{" "}
                      <strong className="text-mist-50">
                        {hoveredDot.evaluations.toLocaleString("en-US")}
                      </strong>
                    </span>
                    <span>
                      Runtime{" "}
                      <strong className="text-spark-400">
                        {hoveredDot.runtimeS.toFixed(2)}s
                      </strong>
                    </span>
                  </div>
                </>
              ) : (
                <span className="text-mist-300">
                  SA {(saSummary?.meanFitness ?? 68.71).toFixed(2)} ±{" "}
                  {(saSummary?.stdFitness ?? 0.4).toFixed(2)} (min{" "}
                  {(saSummary?.worstFitness ?? 67.79).toFixed(2)}, max{" "}
                  {(saSummary?.bestFitness ?? 69.35).toFixed(2)}) vs
                  HillClimbing {(hcSummary?.meanFitness ?? 65.88).toFixed(2)} ±{" "}
                  {(hcSummary?.stdFitness ?? 1.2).toFixed(2)}
                </span>
              )}
            </div>

            <div className="rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden">
              <svg
                viewBox={`0 0 ${distGeom.w} ${distGeom.h}`}
                role="img"
                aria-label="30-seed fitness dot-strip and interquartile range comparison across 150 runs"
                className="w-full h-auto block select-none"
              >
                {distGeom.xTicks.map((t) => {
                  const x = distGeom.xOf(t);
                  return (
                    <g key={t}>
                      <line
                        x1={x}
                        x2={x}
                        y1={distGeom.pad.top}
                        y2={distGeom.pad.top + distGeom.ih}
                        stroke="#2A2F52"
                        strokeDasharray="3 4"
                        strokeWidth={1}
                      />
                      <text
                        x={x}
                        y={distGeom.h - 14}
                        textAnchor="middle"
                        className="fill-mist-300 text-[10px] font-mono"
                      >
                        {t}
                      </text>
                    </g>
                  );
                })}

                {distGeom.rows.map((row) => {
                  const color = AGENT_COLORS[row.agent] ?? "#A9A5C6";
                  const xMin = distGeom.xOf(row.min);
                  const xMax = distGeom.xOf(row.max);
                  const xQ1 = distGeom.xOf(row.q1);
                  const xQ3 = distGeom.xOf(row.q3);
                  const xMed = distGeom.xOf(row.med);
                  return (
                    <g key={row.agent}>
                      <text
                        x={distGeom.pad.left - 12}
                        y={row.y + 4}
                        textAnchor="end"
                        className="fill-mist-50 text-[11px] font-mono"
                      >
                        {row.agent}
                      </text>

                      {/* Whisker */}
                      <line
                        x1={xMin}
                        x2={xMax}
                        y1={row.y}
                        y2={row.y}
                        stroke={color}
                        strokeOpacity={0.5}
                        strokeWidth={1.4}
                      />

                      {/* IQR Box */}
                      <rect
                        x={xQ1}
                        y={row.y - 9}
                        width={Math.max(xQ3 - xQ1, 3)}
                        height={18}
                        rx={4}
                        fill={color}
                        fillOpacity={0.2}
                        stroke={color}
                        strokeWidth={1.2}
                      />

                      {/* Median bar */}
                      <line
                        x1={xMed}
                        x2={xMed}
                        y1={row.y - 11}
                        y2={row.y + 11}
                        stroke="#EEEAF4"
                        strokeWidth={2}
                      />

                      {/* All 30 seed dots */}
                      {row.dots.map((d) => {
                        const jitter = (((d.seed * 37) % 11) - 5) * 1.4;
                        const isHovered =
                          hoveredDot?.agent === d.agent &&
                          hoveredDot?.seed === d.seed;
                        return (
                          <circle
                            key={`${d.agent}-${d.seed}`}
                            cx={distGeom.xOf(d.fitness)}
                            cy={row.y + jitter}
                            r={isHovered ? 4.8 : 3.0}
                            fill={color}
                            fillOpacity={isHovered ? 1 : 0.85}
                            stroke={isHovered ? "#EEEAF4" : "#0A0C18"}
                            strokeWidth={isHovered ? 1.5 : 0.8}
                            className="cursor-pointer"
                            onMouseEnter={() => setHoveredDot(d)}
                            onMouseLeave={() => setHoveredDot(null)}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Clean tabular summary strip */}
            <div className="mt-4 pt-4 border-t border-ink-700 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs font-mono tabular-nums">
              {distGeom.rows.map((row) => (
                <div key={row.agent}>
                  <div className="text-mist-300 truncate">{row.agent}</div>
                  <div className="mt-0.5 text-sm font-semibold text-mist-50">
                    {(row.summary?.meanFitness ?? 0).toFixed(2)} ±{" "}
                    {(row.summary?.stdFitness ?? 0).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-mist-300">
                    [{(row.summary?.worstFitness ?? 0).toFixed(2)},{" "}
                    {(row.summary?.bestFitness ?? 0).toFixed(2)}]
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Expandable Math Disclosure */}
      <MathDisclosure
        title="Inspect the Math: Cooling Schedule, 2-Swap Moves, and Squad Fitness"
        className="mt-6"
      >
        <p>
          <strong className="text-mist-50">Geometric Cooling &amp; Metropolis:</strong>{" "}
          Temperature decays as{" "}
          <code className="font-mono text-spark-400">
            T_k = max(T_0 * alpha^k, T_min)
          </code>{" "}
          with{" "}
          <code className="font-mono text-mist-50">
            T_0 = 10.0, alpha = 0.995, T_min = 1e-4
          </code>{" "}
          over 5,000 evaluations. Worse candidate squads with{" "}
          <code className="font-mono text-mist-50">
            delta = F(S&apos;) - F(S) &lt; 0
          </code>{" "}
          are accepted with probability{" "}
          <code className="font-mono text-crimson-400">exp(delta / T_k)</code>.
        </p>
        <p>
          <strong className="text-mist-50">
            Mixed Neighbourhood (80% 1-Swap / 20% 2-Swap):
          </strong>{" "}
          80% of moves replace one player within position; 20% execute a
          cross-position two-player upgrade-and-downgrade move so the search
          escapes the £0.0m remaining-bank local trap where single upgrades are
          infeasible.
        </p>
        <p>
          <strong className="text-mist-50">
            Hard Rules &amp; Exact Lineup Fitness:
          </strong>{" "}
          Every state obeys the £100.0m budget, 2 GK / 5 DEF / 5 MID / 3 FWD
          squad quota, and max 3 players per club. Given 15 players, the exact
          starting XI (1 GK, min 3 DEF / 2 MID / 1 FWD, plus top 4 remaining
          outfielders) and captain are scored via{" "}
          <code className="font-mono text-crimson-400">
            F(S) = sum_XI xP(p) + xP(captain) + 0.1 * sum_bench xP(b)
          </code>
          .
        </p>
      </MathDisclosure>
    </section>
  );
}

export default AnnealingTheaterSection;
