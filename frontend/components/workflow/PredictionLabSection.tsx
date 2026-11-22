"use client";

import React, { useId, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChartLineUp, SlidersHorizontal } from "@phosphor-icons/react";
import type { CalibrationBin, WorkflowDataset } from "../../lib/workflowTypes";
import { MathDisclosure } from "./MathDisclosure";

export interface PredictionLabSectionProps {
  ml: WorkflowDataset["ml"];
}

type LabTab = "rmse" | "calibration" | "defcon";
type ExplorerPos = "DEF" | "MID" | "FWD";
type ModelKey = "hgb" | "ridge" | "rolling3";

const MODEL_META: Record<
  ModelKey,
  { label: string; color: string; dashed?: boolean }
> = {
  hgb: { label: "HistGradientBoosting", color: "#C9023E" },
  ridge: { label: "RidgeCV", color: "#74CBE9" },
  rolling3: { label: "Rolling3Avg", color: "#6C8CF0", dashed: true },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function niceStep(span: number, targetTicks = 4): number {
  if (span <= 0) return 1;
  const raw = span / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  if (norm <= 1.5) return 1 * pow;
  if (norm <= 3) return 2 * pow;
  if (norm <= 7) return 5 * pow;
  return 10 * pow;
}

/**
 * Interactive ML validation suite and decoupled xP + DefCon formula explorer.
 */
export function PredictionLabSection({ ml }: PredictionLabSectionProps) {
  const [activeTab, setActiveTab] = useState<LabTab>("rmse");
  const [hoverGwIdx, setHoverGwIdx] = useState<number | null>(null);
  const [hoverCalIdx, setHoverCalIdx] = useState<number | null>(null);
  const [hoverDefconIdx, setHoverDefconIdx] = useState<number | null>(null);
  const [visibleModels, setVisibleModels] = useState<Record<ModelKey, boolean>>(
    {
      hgb: true,
      ridge: true,
      rolling3: true,
    }
  );

  // Interactive illustrative formula explorer state
  const [pos, setPos] = useState<ExplorerPos>("DEF");
  const [xgXa90, setXgXa90] = useState<number>(0.34);
  const [actions90, setActions90] = useState<number>(9.8);
  const [fdr, setFdr] = useState<number>(3);
  const [availabilityPct, setAvailabilityPct] = useState<number>(100);

  const reduceMotion = useReducedMotion();
  const tabLayoutId = useId();
  const xgId = useId();
  const actId = useId();
  const fdrId = useId();
  const availId = useId();

  // Extract regression headline metrics cleanly from `all fixtures` subset
  const allFixtureMetrics = useMemo(() => {
    const rows = ml.regression.filter((r) => r.subset === "all fixtures");
    const hgb = rows.find((r) => r.model === "HistGradientBoosting");
    const ridge = rows.find((r) => r.model === "RidgeCV");
    const roll = rows.find((r) => r.model === "Rolling3Avg");
    const rmseDeltaPct =
      hgb && roll && roll.rmse > 0
        ? ((hgb.rmse - roll.rmse) / roll.rmse) * 100
        : -11.0;
    return { hgb, ridge, roll, rmseDeltaPct };
  }, [ml.regression]);

  const toggleModel = (key: ModelKey) => {
    setVisibleModels((prev) => {
      const activeCount = Object.values(prev).filter(Boolean).length;
      if (prev[key] && activeCount <= 1) return prev;
      return { ...prev, [key]: !prev[key] };
    });
  };

  // Illustrative decoupled xP formula calculation
  const explorer = useMemo(() => {
    const threshold = pos === "DEF" ? 10 : 12;
    const attackWeight = pos === "DEF" ? 5.2 : pos === "MID" ? 4.6 : 4.2;
    const fdrAttackFactor = 1 + (3 - fdr) * 0.08;
    const csContribution =
      pos === "DEF"
        ? fdr <= 2
          ? 1.55
          : fdr === 3
          ? 1.05
          : fdr === 4
          ? 0.65
          : 0.42
        : pos === "MID"
        ? fdr <= 2
          ? 0.42
          : fdr === 3
          ? 0.25
          : 0.12
        : 0.0;

    const appearanceBase = 1.85;
    const rawXpBase = clamp(
      appearanceBase + xgXa90 * attackWeight * fdrAttackFactor + csContribution,
      0.5,
      12.5
    );

    const effectiveActions = actions90 + (fdr - 3) * 0.55;
    const logit =
      (effectiveActions - threshold) * 0.65 - (pos === "FWD" ? 1.15 : 0.0);
    const pDefcon = clamp(1 / (1 + Math.exp(-logit)), 0.005, 0.72);

    const avail = availabilityPct / 100;
    const xpBase = avail * rawXpBase;
    const defconLift = avail * 2.0 * pDefcon;
    const totalXp = xpBase + defconLift;
    const baseShare = totalXp > 0 ? (xpBase / totalXp) * 100 : 100;
    const liftShare = 100 - baseShare;

    return {
      threshold,
      metricLabel: pos === "DEF" ? "Rolling CBIT / 90" : "Rolling CBIRT / 90",
      pDefcon,
      xpBase,
      defconLift,
      totalXp,
      baseShare,
      liftShare,
    };
  }, [pos, xgXa90, actions90, fdr, availabilityPct]);

  // Tab 1: Per-GW RMSE SVG geometry
  const rmseChart = useMemo(() => {
    const rows = ml.perGwRmse;
    const w = 640;
    const h = 285;
    const pad = { top: 22, right: 20, bottom: 38, left: 48 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    if (!rows.length) {
      return { w, h, pad, iw, ih, minY: 0, maxY: 3, ticksY: [0, 1, 2, 3], rows };
    }

    const vals = rows.flatMap((r) => [r.hgb, r.ridge, r.rolling3]);
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const minY = Math.max(0, Math.floor((rawMin - 0.15) * 2) / 2);
    const maxY = Math.ceil((rawMax + 0.15) * 2) / 2;
    const step = niceStep(maxY - minY, 4);
    const ticksY: number[] = [];
    for (let t = minY; t <= maxY + 1e-6; t += step) {
      ticksY.push(Number(t.toFixed(2)));
    }

    const xOf = (idx: number) =>
      pad.left + (idx / Math.max(rows.length - 1, 1)) * iw;
    const yOf = (v: number) =>
      pad.top + ih - ((v - minY) / Math.max(maxY - minY, 1e-6)) * ih;

    const lineFor = (key: ModelKey) =>
      rows.map((r, i) => `${xOf(i).toFixed(1)},${yOf(r[key]).toFixed(1)}`).join(" ");

    return {
      w,
      h,
      pad,
      iw,
      ih,
      minY,
      maxY,
      ticksY,
      rows,
      xOf,
      yOf,
      paths: {
        hgb: lineFor("hgb"),
        ridge: lineFor("ridge"),
        rolling3: lineFor("rolling3"),
      },
    };
  }, [ml.perGwRmse]);

  const activeRmseIdx =
    hoverGwIdx !== null && rmseChart.rows[hoverGwIdx]
      ? hoverGwIdx
      : rmseChart.rows.length > 0
      ? rmseChart.rows.length - 1
      : null;

  // Tab 2: Quantile Calibration SVG geometry
  const calChart = useMemo(() => {
    const w = 640;
    const h = 285;
    const pad = { top: 22, right: 24, bottom: 40, left: 50 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const allBins: CalibrationBin[] = [
      ...(visibleModels.hgb ? ml.calibration.hgb : []),
      ...(visibleModels.ridge ? ml.calibration.ridge : []),
      ...(visibleModels.rolling3 ? ml.calibration.rolling3 : []),
    ];
    const allNums = allBins.flatMap((b) => [b.meanPred, b.meanActual]);
    const minV = allNums.length ? Math.min(0, Math.floor(Math.min(...allNums) * 2) / 2) : 0;
    const maxV = allNums.length ? Math.ceil(Math.max(...allNums, 4) * 2) / 2 : 5;
    const step = niceStep(maxV - minV, 4);
    const ticks: number[] = [];
    for (let t = minV; t <= maxV + 1e-6; t += step) {
      ticks.push(Number(t.toFixed(2)));
    }

    const xOf = (v: number) =>
      pad.left + ((v - minV) / Math.max(maxV - minV, 1e-6)) * iw;
    const yOf = (v: number) =>
      pad.top + ih - ((v - minV) / Math.max(maxV - minV, 1e-6)) * ih;

    return { w, h, pad, iw, ih, minV, maxV, ticks, xOf, yOf };
  }, [ml.calibration, visibleModels]);

  const primaryCalBins = visibleModels.hgb
    ? ml.calibration.hgb
    : visibleModels.ridge
    ? ml.calibration.ridge
    : ml.calibration.rolling3;

  const activeCalIdx =
    primaryCalBins.length === 0
      ? null
      : hoverCalIdx !== null
      ? Math.min(hoverCalIdx, primaryCalBins.length - 1)
      : primaryCalBins.length - 1;

  // Tab 3: DefCon Reliability SVG geometry
  const defconChart = useMemo(() => {
    const bins = ml.defconReliability;
    const w = 640;
    const h = 285;
    const pad = { top: 22, right: 24, bottom: 40, left: 54 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const maxProb = bins.length
      ? Math.max(...bins.flatMap((b) => [b.meanProb, b.empiricalRate]))
      : 0.4;
    const axisMax = clamp(Math.ceil(maxProb * 10) / 10 + 0.05, 0.3, 1.0);
    const step = axisMax <= 0.45 ? 0.1 : 0.2;
    const ticks: number[] = [];
    for (let t = 0; t <= axisMax + 1e-6; t += step) {
      ticks.push(Number(t.toFixed(2)));
    }
    const maxCount = bins.length ? Math.max(...bins.map((b) => b.count), 1) : 1;

    const xOf = (v: number) => pad.left + (v / axisMax) * iw;
    const yOf = (v: number) => pad.top + ih - (v / axisMax) * ih;

    return { w, h, pad, iw, ih, axisMax, ticks, maxCount, bins, xOf, yOf };
  }, [ml.defconReliability]);

  const activeDefconIdx =
    hoverDefconIdx !== null && defconChart.bins[hoverDefconIdx]
      ? hoverDefconIdx
      : defconChart.bins.length > 0
      ? defconChart.bins.length - 1
      : null;

  return (
    <section
      id="prediction"
      aria-labelledby="prediction-heading"
      className="py-20 px-4 sm:px-6 max-w-7xl mx-auto w-full"
    >
      {/* Stacked section header (no eyebrow, no split-header anti-pattern) */}
      <div className="max-w-[65ch]">
        <h2
          id="prediction-heading"
          className="font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50"
        >
          Decoupled Expected Points and DefCon Calibration
        </h2>
        <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed">
          Gradient boosting forecasts DefCon-free base points while an isotonic
          classifier calibrates the +2 defensive contribution bonus.
        </p>
      </div>

      {/* Asymmetric 12-column grid */}
      <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Empirical Graph Suite */}
        <div className="lg:col-span-7 rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6 min-w-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-mist-50">
              <ChartLineUp
                size={18}
                weight="bold"
                aria-hidden="true"
                className="text-crimson-400 shrink-0"
              />
              <h3 className="text-sm font-semibold tracking-tight">
                Out-of-Sample Model Validation (2025-26)
              </h3>
            </div>

            {/* Segmented pill tabs */}
            <div
              role="tablist"
              aria-label="Validation charts"
              className="inline-flex flex-wrap sm:flex-nowrap max-w-full items-center gap-1 rounded-2xl sm:rounded-full border border-ink-700 bg-ink-950 p-1 self-start"
            >
              {(
                [
                  { id: "rmse", label: "Per-GW RMSE" },
                  { id: "calibration", label: "Quantile Calibration" },
                  { id: "defcon", label: "DefCon Reliability" },
                ] as const
              ).map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTab(tab.id)}
                    className={[
                      "relative rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                      selected
                        ? "text-mist-50"
                        : "text-mist-300 hover:text-mist-50",
                    ].join(" ")}
                  >
                    {selected && (
                      <motion.span
                        layoutId={
                          reduceMotion ? undefined : `lab-tab-${tabLayoutId}`
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

          {/* Tab 1: Per-GW RMSE */}
          {activeTab === "rmse" && (
            <div className="mt-5">
              {/* Interactive hover readout strip */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-950/90 px-3.5 py-2 text-xs font-mono tabular-nums">
                {activeRmseIdx !== null && rmseChart.rows[activeRmseIdx] ? (
                  <>
                    <span className="text-mist-50 font-semibold">
                      GW {rmseChart.rows[activeRmseIdx].gw}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="inline-flex items-center gap-1.5 text-mist-300">
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 rounded-full bg-crimson-500"
                        />
                        HGB{" "}
                        <strong className="text-mist-50">
                          {rmseChart.rows[activeRmseIdx].hgb.toFixed(3)}
                        </strong>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-mist-300">
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 rounded-full bg-spark-400"
                        />
                        RidgeCV{" "}
                        <strong className="text-mist-50">
                          {rmseChart.rows[activeRmseIdx].ridge.toFixed(3)}
                        </strong>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-mist-300">
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 rounded-full bg-cobalt-400"
                        />
                        Rolling-3{" "}
                        <strong className="text-mist-50">
                          {rmseChart.rows[activeRmseIdx].rolling3.toFixed(3)}
                        </strong>
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-mist-300">
                    Hover across gameweeks to inspect per-GW RMSE
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden">
                <svg
                  viewBox={`0 0 ${rmseChart.w} ${rmseChart.h}`}
                  role="img"
                  aria-label="Per-gameweek RMSE line chart comparing HistGradientBoosting, RidgeCV, and Rolling3Avg across GW1 to GW38"
                  className="w-full h-auto block select-none"
                >
                  {/* Y gridlines and tick labels */}
                  {rmseChart.ticksY.map((t) => {
                    const y = rmseChart.yOf ? rmseChart.yOf(t) : rmseChart.pad.top;
                    return (
                      <g key={t}>
                        <line
                          x1={rmseChart.pad.left}
                          x2={rmseChart.w - rmseChart.pad.right}
                          y1={y}
                          y2={y}
                          stroke="#2A2F52"
                          strokeDasharray="3 4"
                          strokeWidth={1}
                        />
                        <text
                          x={rmseChart.pad.left - 8}
                          y={y + 3.5}
                          textAnchor="end"
                          className="fill-mist-300 text-[10px] font-mono"
                        >
                          {t.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}

                  {/* X-axis gameweek ticks */}
                  {rmseChart.rows
                    .filter((r) => [1, 8, 15, 22, 29, 38].includes(r.gw))
                    .map((r) => {
                      const idx = rmseChart.rows.indexOf(r);
                      const x = rmseChart.xOf ? rmseChart.xOf(idx) : 0;
                      return (
                        <text
                          key={r.gw}
                          x={x}
                          y={rmseChart.h - 14}
                          textAnchor="middle"
                          className="fill-mist-300 text-[10px] font-mono"
                        >
                          GW{r.gw}
                        </text>
                      );
                    })}

                  {/* Y-axis label */}
                  <text
                    x={14}
                    y={rmseChart.pad.top + rmseChart.ih / 2}
                    transform={`rotate(-90 14 ${rmseChart.pad.top + rmseChart.ih / 2})`}
                    textAnchor="middle"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    RMSE (pts)
                  </text>

                  {/* Series polylines */}
                  {rmseChart.paths && (
                    <>
                      <polyline
                        fill="none"
                        stroke={MODEL_META.rolling3.color}
                        strokeWidth={1.7}
                        strokeDasharray="5 4"
                        strokeLinejoin="round"
                        points={rmseChart.paths.rolling3}
                      />
                      <polyline
                        fill="none"
                        stroke={MODEL_META.ridge.color}
                        strokeWidth={1.9}
                        strokeLinejoin="round"
                        points={rmseChart.paths.ridge}
                      />
                      <polyline
                        fill="none"
                        stroke={MODEL_META.hgb.color}
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                        points={rmseChart.paths.hgb}
                      />
                    </>
                  )}

                  {/* Interactive hover crosshair */}
                  {activeRmseIdx !== null &&
                    rmseChart.rows[activeRmseIdx] &&
                    rmseChart.xOf &&
                    rmseChart.yOf && (
                      <g aria-hidden="true">
                        <line
                          x1={rmseChart.xOf(activeRmseIdx)}
                          x2={rmseChart.xOf(activeRmseIdx)}
                          y1={rmseChart.pad.top}
                          y2={rmseChart.pad.top + rmseChart.ih}
                          stroke="#EEEAF4"
                          strokeOpacity={0.35}
                          strokeWidth={1}
                        />
                        <circle
                          cx={rmseChart.xOf(activeRmseIdx)}
                          cy={rmseChart.yOf(rmseChart.rows[activeRmseIdx].rolling3)}
                          r={3.5}
                          fill="#6C8CF0"
                          stroke="#0A0C18"
                          strokeWidth={1.5}
                        />
                        <circle
                          cx={rmseChart.xOf(activeRmseIdx)}
                          cy={rmseChart.yOf(rmseChart.rows[activeRmseIdx].ridge)}
                          r={3.5}
                          fill="#74CBE9"
                          stroke="#0A0C18"
                          strokeWidth={1.5}
                        />
                        <circle
                          cx={rmseChart.xOf(activeRmseIdx)}
                          cy={rmseChart.yOf(rmseChart.rows[activeRmseIdx].hgb)}
                          r={4.5}
                          fill="#E5225A"
                          stroke="#EEEAF4"
                          strokeWidth={1.5}
                        />
                      </g>
                    )}

                  {/* Pointer capture rect */}
                  <rect
                    x={rmseChart.pad.left}
                    y={rmseChart.pad.top}
                    width={rmseChart.iw}
                    height={rmseChart.ih}
                    fill="transparent"
                    className="cursor-crosshair"
                    onPointerMove={(e) => {
                      if (!rmseChart.rows.length) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const rel = clamp(
                        (e.clientX - rect.left) / Math.max(rect.width, 1),
                        0,
                        1
                      );
                      setHoverGwIdx(
                        Math.round(rel * (rmseChart.rows.length - 1))
                      );
                    }}
                    onPointerLeave={() => setHoverGwIdx(null)}
                  />
                </svg>
              </div>

              {/* Compact 3-model comparison strip (typographic columns with hairlines) */}
              <div className="mt-4 pt-4 border-t border-ink-700 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    HGB RMSE
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-mist-50 tabular-nums">
                    {(allFixtureMetrics.hgb?.rmse ?? 1.85).toFixed(3)}
                  </div>
                  <div className="text-[11px] font-mono text-mist-300 tabular-nums">
                    Ridge {(allFixtureMetrics.ridge?.rmse ?? 1.855).toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    HGB MAE
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-mist-50 tabular-nums">
                    {(allFixtureMetrics.hgb?.mae ?? 0.934).toFixed(3)}
                  </div>
                  <div className="text-[11px] font-mono text-mist-300 tabular-nums">
                    Roll-3 {(allFixtureMetrics.roll?.mae ?? 0.998).toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    HGB R^2
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-mist-50 tabular-nums">
                    {(allFixtureMetrics.hgb?.r2 ?? 0.305).toFixed(3)}
                  </div>
                  <div className="text-[11px] font-mono text-mist-300 tabular-nums">
                    Roll-3 {(allFixtureMetrics.roll?.r2 ?? 0.122).toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    vs Rolling-3
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-crimson-400 tabular-nums">
                    {allFixtureMetrics.rmseDeltaPct.toFixed(1)}%
                  </div>
                  <div className="text-[11px] font-mono text-mist-300">
                    All OOS fixtures
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Quantile Calibration */}
          {activeTab === "calibration" && (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(["hgb", "ridge", "rolling3"] as const).map((key) => {
                    const active = visibleModels[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleModel(key)}
                        className={[
                          "rounded-full px-3 py-1 text-[11px] font-mono font-semibold border transition-colors cursor-pointer inline-flex items-center gap-1.5",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                          active
                            ? "border-ink-700 bg-ink-800 text-mist-50"
                            : "border-ink-700/60 bg-ink-950 text-mist-300 opacity-55 hover:opacity-85",
                        ].join(" ")}
                      >
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: MODEL_META[key].color }}
                        />
                        {MODEL_META[key].label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] font-mono text-mist-300">
                  15-quantile predicted vs actual target_base
                </span>
              </div>

              {/* Hover readout strip */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-950/90 px-3.5 py-2 text-xs font-mono tabular-nums">
                {activeCalIdx !== null && primaryCalBins[activeCalIdx] ? (
                  <>
                    <span className="text-mist-50 font-semibold">
                      Quantile Bin #{primaryCalBins[activeCalIdx].bin} (n=
                      {primaryCalBins[activeCalIdx].count.toLocaleString("en-US")})
                    </span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {visibleModels.hgb && ml.calibration.hgb[activeCalIdx] && (
                        <span className="text-mist-300">
                          HGB{" "}
                          <strong className="text-mist-50">
                            {ml.calibration.hgb[activeCalIdx].meanPred.toFixed(2)}
                            {" -> "}
                            {ml.calibration.hgb[activeCalIdx].meanActual.toFixed(2)}
                          </strong>
                        </span>
                      )}
                      {visibleModels.ridge && ml.calibration.ridge[activeCalIdx] && (
                        <span className="text-mist-300">
                          Ridge{" "}
                          <strong className="text-mist-50">
                            {ml.calibration.ridge[activeCalIdx].meanPred.toFixed(2)}
                            {" -> "}
                            {ml.calibration.ridge[activeCalIdx].meanActual.toFixed(2)}
                          </strong>
                        </span>
                      )}
                      {visibleModels.rolling3 &&
                        ml.calibration.rolling3[activeCalIdx] && (
                          <span className="text-mist-300">
                            Roll-3{" "}
                            <strong className="text-mist-50">
                              {ml.calibration.rolling3[activeCalIdx].meanPred.toFixed(2)}
                              {" -> "}
                              {ml.calibration.rolling3[activeCalIdx].meanActual.toFixed(2)}
                            </strong>
                          </span>
                        )}
                    </div>
                  </>
                ) : (
                  <span className="text-mist-300">
                    Hover quantile bins to inspect predicted vs realised points
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden">
                <svg
                  viewBox={`0 0 ${calChart.w} ${calChart.h}`}
                  role="img"
                  aria-label="15-quantile predicted versus actual target_base calibration chart against the y equals x diagonal"
                  className="w-full h-auto block select-none"
                >
                  {calChart.ticks.map((t) => {
                    const y = calChart.yOf(t);
                    const x = calChart.xOf(t);
                    return (
                      <g key={t}>
                        <line
                          x1={calChart.pad.left}
                          x2={calChart.w - calChart.pad.right}
                          y1={y}
                          y2={y}
                          stroke="#2A2F52"
                          strokeDasharray="3 4"
                          strokeWidth={1}
                        />
                        <text
                          x={calChart.pad.left - 8}
                          y={y + 3.5}
                          textAnchor="end"
                          className="fill-mist-300 text-[10px] font-mono"
                        >
                          {t.toFixed(1)}
                        </text>
                        <text
                          x={x}
                          y={calChart.h - 18}
                          textAnchor="middle"
                          className="fill-mist-300 text-[10px] font-mono"
                        >
                          {t.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Diagonal y = x reference */}
                  <line
                    x1={calChart.xOf(calChart.minV)}
                    y1={calChart.yOf(calChart.minV)}
                    x2={calChart.xOf(calChart.maxV)}
                    y2={calChart.yOf(calChart.maxV)}
                    stroke="#7E7A9E"
                    strokeDasharray="5 4"
                    strokeWidth={1.3}
                  />
                  <text
                    x={calChart.w - calChart.pad.right - 6}
                    y={calChart.pad.top + 14}
                    textAnchor="end"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    Perfect y = x
                  </text>

                  {/* Model calibration curves */}
                  {(["rolling3", "ridge", "hgb"] as const).map((key) => {
                    if (!visibleModels[key]) return null;
                    const bins = ml.calibration[key];
                    if (!bins.length) return null;
                    const pts = bins
                      .map(
                        (b) =>
                          `${calChart.xOf(b.meanPred).toFixed(1)},${calChart
                            .yOf(b.meanActual)
                            .toFixed(1)}`
                      )
                      .join(" ");
                    return (
                      <g key={key}>
                        <polyline
                          fill="none"
                          stroke={MODEL_META[key].color}
                          strokeWidth={key === "hgb" ? 2.4 : 1.7}
                          strokeDasharray={MODEL_META[key].dashed ? "5 4" : undefined}
                          points={pts}
                        />
                        {bins.map((b, i) => {
                          const isHovered = activeCalIdx === i;
                          return (
                            <circle
                              key={b.bin}
                              cx={calChart.xOf(b.meanPred)}
                              cy={calChart.yOf(b.meanActual)}
                              r={isHovered ? 5 : 3.2}
                              fill={MODEL_META[key].color}
                              stroke={isHovered ? "#EEEAF4" : "#0A0C18"}
                              strokeWidth={isHovered ? 1.6 : 1}
                              className="cursor-pointer"
                              onMouseEnter={() => setHoverCalIdx(i)}
                            />
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* Axis labels */}
                  <text
                    x={calChart.pad.left + calChart.iw / 2}
                    y={calChart.h - 4}
                    textAnchor="middle"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    Mean Predicted xP_base
                  </text>
                  <text
                    x={14}
                    y={calChart.pad.top + calChart.ih / 2}
                    transform={`rotate(-90 14 ${calChart.pad.top + calChart.ih / 2})`}
                    textAnchor="middle"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    Mean Actual target_base
                  </text>
                </svg>
              </div>
            </div>
          )}

          {/* Tab 3: DefCon Reliability */}
          {activeTab === "defcon" && (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-950/90 px-3.5 py-2 text-xs font-mono tabular-nums">
                {activeDefconIdx !== null &&
                defconChart.bins[activeDefconIdx] ? (
                  <>
                    <span className="text-mist-50 font-semibold">
                      Decile Bin #{defconChart.bins[activeDefconIdx].bin}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mist-300">
                      <span>
                        Predicted P(DefCon){" "}
                        <strong className="text-spark-400">
                          {(
                            defconChart.bins[activeDefconIdx].meanProb * 100
                          ).toFixed(2)}
                          %
                        </strong>
                      </span>
                      <span>
                        Empirical Hit{" "}
                        <strong className="text-crimson-400">
                          {(
                            defconChart.bins[activeDefconIdx].empiricalRate * 100
                          ).toFixed(2)}
                          %
                        </strong>
                      </span>
                      <span>
                        n={" "}
                        <strong className="text-mist-50">
                          {defconChart.bins[
                            activeDefconIdx
                          ].count.toLocaleString("en-US")}
                        </strong>
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-mist-300">
                    Hover reliability bins to inspect isotonic calibration
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden">
                <svg
                  viewBox={`0 0 ${defconChart.w} ${defconChart.h}`}
                  role="img"
                  aria-label="10-bin isotonic DefCon reliability diagram plotting predicted probability against empirical hit rate"
                  className="w-full h-auto block select-none"
                >
                  {defconChart.ticks.map((t) => {
                    const y = defconChart.yOf(t);
                    const x = defconChart.xOf(t);
                    return (
                      <g key={t}>
                        <line
                          x1={defconChart.pad.left}
                          x2={defconChart.w - defconChart.pad.right}
                          y1={y}
                          y2={y}
                          stroke="#2A2F52"
                          strokeDasharray="3 4"
                          strokeWidth={1}
                        />
                        <text
                          x={defconChart.pad.left - 8}
                          y={y + 3.5}
                          textAnchor="end"
                          className="fill-mist-300 text-[10px] font-mono"
                        >
                          {Math.round(t * 100)}%
                        </text>
                        <text
                          x={x}
                          y={defconChart.h - 18}
                          textAnchor="middle"
                          className="fill-mist-300 text-[10px] font-mono"
                        >
                          {Math.round(t * 100)}%
                        </text>
                      </g>
                    );
                  })}

                  {/* Perfect calibration line */}
                  <line
                    x1={defconChart.xOf(0)}
                    y1={defconChart.yOf(0)}
                    x2={defconChart.xOf(defconChart.axisMax)}
                    y2={defconChart.yOf(defconChart.axisMax)}
                    stroke="#74CBE9"
                    strokeOpacity={0.65}
                    strokeDasharray="5 4"
                    strokeWidth={1.4}
                  />
                  <text
                    x={defconChart.w - defconChart.pad.right - 6}
                    y={defconChart.pad.top + 14}
                    textAnchor="end"
                    className="fill-spark-400 text-[10px] font-mono"
                  >
                    Ideal calibration (y = x)
                  </text>

                  {/* Reliability polyline */}
                  {defconChart.bins.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#C9023E"
                      strokeWidth={2.4}
                      points={defconChart.bins
                        .map(
                          (b) =>
                            `${defconChart.xOf(b.meanProb).toFixed(1)},${defconChart
                              .yOf(b.empiricalRate)
                              .toFixed(1)}`
                        )
                        .join(" ")}
                    />
                  )}

                  {/* Bin points scaled gently by sqrt(count) */}
                  {defconChart.bins.map((b, i) => {
                    const r =
                      3.5 +
                      Math.sqrt(b.count / defconChart.maxCount) * 4.5;
                    const isHovered = activeDefconIdx === i;
                    return (
                      <circle
                        key={b.bin}
                        cx={defconChart.xOf(b.meanProb)}
                        cy={defconChart.yOf(b.empiricalRate)}
                        r={isHovered ? r + 1.5 : r}
                        fill="#E5225A"
                        fillOpacity={0.9}
                        stroke={isHovered ? "#EEEAF4" : "#0A0C18"}
                        strokeWidth={isHovered ? 1.8 : 1.2}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoverDefconIdx(i)}
                      />
                    );
                  })}

                  <text
                    x={defconChart.pad.left + defconChart.iw / 2}
                    y={defconChart.h - 4}
                    textAnchor="middle"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    Calibrated P(DefCon Hit)
                  </text>
                  <text
                    x={14}
                    y={defconChart.pad.top + defconChart.ih / 2}
                    transform={`rotate(-90 14 ${defconChart.pad.top + defconChart.ih / 2})`}
                    textAnchor="middle"
                    className="fill-mist-300 text-[10px] font-mono"
                  >
                    Empirical Hit Rate
                  </text>
                </svg>
              </div>

              {/* DefCon evaluation summary strip */}
              <div className="mt-4 pt-4 border-t border-ink-700 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    ROC-AUC
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-mist-50 tabular-nums">
                    {ml.defcon.auc.toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    Brier Score
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-spark-400 tabular-nums">
                    {ml.defcon.brier.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    Base Rate
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-mist-50 tabular-nums">
                    {(ml.defcon.baseRate * 100).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-mono text-mist-300">
                    Outfield N
                  </div>
                  <div className="mt-0.5 text-xl font-display font-bold text-mist-50 tabular-nums">
                    {ml.defcon.n.toLocaleString("en-US")}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right 5 cols: Interactive Decoupled xP & DefCon Explorer */}
        <div className="lg:col-span-5 rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-mist-50">
                <SlidersHorizontal
                  size={18}
                  weight="bold"
                  aria-hidden="true"
                  className="text-spark-400 shrink-0"
                />
                <h3 className="text-sm font-semibold tracking-tight">
                  Interactive Formula Explorer (Illustrative)
                </h3>
              </div>
              <p className="mt-1 text-xs text-mist-300">
                Live heuristic approximation of the decoupled xP and DefCon
                scoring formula.
              </p>
            </div>
          </div>

          {/* Position selector pills */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="Outfield position"
              className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-950 p-1"
            >
              {(["DEF", "MID", "FWD"] as const).map((p) => {
                const active = pos === p;
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPos(p)}
                    className={[
                      "rounded-full px-3.5 py-1 text-xs font-mono font-semibold transition-colors cursor-pointer",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                      active
                        ? "bg-crimson-500 text-mist-50"
                        : "text-mist-300 hover:text-mist-50",
                    ].join(" ")}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <span className="rounded-full border border-ink-700 bg-ink-950 px-3 py-1 text-[11px] font-mono text-spark-400 tabular-nums">
              Threshold: &gt;= {explorer.threshold}{" "}
              {pos === "DEF" ? "CBIT" : "CBIRT"}
            </span>
          </div>

          {/* 4 Accessible Sliders with labels ABOVE inputs */}
          <div className="mt-5 space-y-4 select-none">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor={xgId}
                  className="text-xs font-medium text-mist-300"
                >
                  Rolling xG + xA / 90
                </label>
                <span className="text-xs font-mono font-semibold text-mist-50 tabular-nums">
                  {xgXa90.toFixed(2)}
                </span>
              </div>
              <input
                id={xgId}
                type="range"
                min={0}
                max={1.2}
                step={0.02}
                value={xgXa90}
                onChange={(e) => setXgXa90(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full bg-ink-950 accent-crimson-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor={actId}
                  className="text-xs font-medium text-mist-300"
                >
                  {explorer.metricLabel}
                </label>
                <span className="text-xs font-mono font-semibold text-mist-50 tabular-nums">
                  {actions90.toFixed(1)}
                </span>
              </div>
              <input
                id={actId}
                type="range"
                min={2.0}
                max={16.0}
                step={0.2}
                value={actions90}
                onChange={(e) => setActions90(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full bg-ink-950 accent-crimson-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor={fdrId}
                  className="text-xs font-medium text-mist-300"
                >
                  Fixture Difficulty FDR
                </label>
                <span className="text-xs font-mono font-semibold text-mist-50 tabular-nums">
                  FDR {fdr}
                </span>
              </div>
              <input
                id={fdrId}
                type="range"
                min={1}
                max={5}
                step={1}
                value={fdr}
                onChange={(e) => setFdr(parseInt(e.target.value, 10))}
                className="w-full h-1.5 rounded-full bg-ink-950 accent-crimson-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor={availId}
                  className="text-xs font-medium text-mist-300"
                >
                  Availability %
                </label>
                <span className="text-xs font-mono font-semibold text-mist-50 tabular-nums">
                  {availabilityPct}%
                </span>
              </div>
              <input
                id={availId}
                type="range"
                min={25}
                max={100}
                step={5}
                value={availabilityPct}
                onChange={(e) => setAvailabilityPct(parseInt(e.target.value, 10))}
                className="w-full h-1.5 rounded-full bg-ink-950 accent-crimson-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
              />
            </div>
          </div>

          {/* Live Numeric Outputs */}
          <div className="mt-6 pt-5 border-t border-ink-700 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-mono uppercase tracking-wider text-mist-300">
                Total Expected Points xP(p)
              </span>
              <span className="text-3xl font-display font-bold text-mist-50 tabular-nums">
                {explorer.totalXp.toFixed(2)} pts
              </span>
            </div>

            {/* Clean SVG stacked decomposition bar */}
            <div>
              <svg
                viewBox="0 0 360 18"
                role="img"
                aria-label={`Expected points composition: ${explorer.xpBase.toFixed(
                  2
                )} base points plus ${explorer.defconLift.toFixed(
                  2
                )} DefCon lift`}
                className="w-full h-4 block rounded-full overflow-hidden"
              >
                <rect
                  x={0}
                  y={2}
                  width={(360 * explorer.baseShare) / 100}
                  height={14}
                  rx={4}
                  fill="#3B63E0"
                />
                <rect
                  x={(360 * explorer.baseShare) / 100 + 2}
                  y={2}
                  width={Math.max(
                    (360 * explorer.liftShare) / 100 - 2,
                    2
                  )}
                  height={14}
                  rx={4}
                  fill="#C9023E"
                />
              </svg>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-mist-300">
                <span>
                  Base share {explorer.baseShare.toFixed(1)}%
                </span>
                <span>
                  DefCon lift {explorer.liftShare.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-ink-700/80 font-mono tabular-nums">
              <div>
                <div className="text-[11px] text-mist-300">xP_base</div>
                <div className="text-sm font-semibold text-cobalt-400">
                  {explorer.xpBase.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-mist-300">P(DefCon)</div>
                <div className="text-sm font-semibold text-spark-400">
                  {(explorer.pDefcon * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-mist-300">+2*P(DefCon)</div>
                <div className="text-sm font-semibold text-crimson-400">
                  +{explorer.defconLift.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expandable Math Disclosure */}
      <MathDisclosure
        title="Inspect the Math: Expanding Chronological CV and Isotonic DefCon Calibration"
        className="mt-6"
      >
        <p>
          <strong className="text-mist-50">
            5-GW Expanding Chronological CV:
          </strong>{" "}
          Models are trained on all historical seasons (2022-23 through 2024-25)
          plus earlier 2025-26 gameweeks before predicting each 5-GW block out
          of sample. No future fixture telemetry ever enters a training fold.
        </p>
        <p>
          <strong className="text-mist-50">Base xP Regressor:</strong>{" "}
          <code className="font-mono text-spark-400">
            HistGradientBoostingRegressor(loss=&quot;squared_error&quot;,
            learning_rate=0.05, max_iter=400, max_leaf_nodes=31,
            min_samples_leaf=40, l2_regularization=1.0)
          </code>{" "}
          predicts the DefCon-free target{" "}
          <code className="font-mono text-mist-50">
            target_base = total_points - defcon_points
          </code>{" "}
          with native NaN handling across pre-2025 seasons.
        </p>
        <p>
          <strong className="text-mist-50">
            Calibrated DefCon Classifier &amp; Recombination:
          </strong>{" "}
          A gradient-boosted classifier wrapped in{" "}
          <code className="font-mono text-spark-400">
            CalibratedClassifierCV(method=&quot;isotonic&quot;, cv=3)
          </code>{" "}
          estimates fixture-level{" "}
          <code className="font-mono text-mist-50">P(DefCon Hit_p)</code> on
          outfield players (GK fixed to 0). Final expected points combine both
          heads:{" "}
          <code className="font-mono text-crimson-400">
            xP(p) = availability * (xP_base(p) + 2 * P(DefCon Hit_p))
          </code>
          .
        </p>
      </MathDisclosure>
    </section>
  );
}

export default PredictionLabSection;
