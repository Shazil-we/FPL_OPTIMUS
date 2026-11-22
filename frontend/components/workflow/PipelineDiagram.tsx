"use client";

import React, { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ChartLineUp,
  CirclesThree,
  Clock,
  Code,
  Database,
  Flame,
  Trophy,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { WorkflowDataset } from "../../lib/workflowTypes";

export interface PipelineDiagramProps {
  meta: WorkflowDataset["meta"];
}

type TimingKey = keyof WorkflowDataset["meta"]["timingsS"];

interface PipelineStage {
  id: string;
  title: string;
  subtitle: string;
  module: string;
  anchor: string;
  timingKey: TimingKey;
  icon: Icon;
  getInputContract: (meta: WorkflowDataset["meta"]) => string;
  getOutputContract: (meta: WorkflowDataset["meta"]) => string;
  guarantee: string;
}

const STAGES: readonly PipelineStage[] = [
  {
    id: "telemetry",
    title: "Telemetry Ingestion",
    subtitle: "Vaastav + FPL API",
    module: "src/data_loader.py",
    anchor: "#telemetry",
    timingKey: "data",
    icon: Database,
    getInputContract: () =>
      "Four seasons of Vaastav CSVs (2022-23 through 2025-26) plus async FPL bootstrap and fixture snapshots.",
    getOutputContract: (meta) =>
      `${meta.totalRecords.toLocaleString("en-US")} standardised player-fixture rows across ${meta.engineeredColumns} engineered columns.`,
    guarantee:
      "Every rolling window and team xG share passes through shift(1) so match t features never read match t outcomes.",
  },
  {
    id: "prediction",
    title: "Decoupled xP & DefCon",
    subtitle: "HGB + Isotonic",
    module: "src/models.py",
    anchor: "#prediction",
    timingKey: "ml",
    icon: ChartLineUp,
    getInputContract: () =>
      "50 shift(1) rolling, per-90, team xG share, venue strength, and FDR features per fixture.",
    getOutputContract: (meta) =>
      `${meta.oosFixtures.toLocaleString("en-US")} out-of-sample target_base xP predictions and calibrated P(DefCon Hit) scores.`,
    guarantee:
      "5-GW expanding chronological CV strictly trains on prior seasons and earlier gameweeks with zero future leakage.",
  },
  {
    id: "archetypes",
    title: "Tactical Archetypes",
    subtitle: "Full-Cov GMM",
    module: "src/models.py",
    anchor: "#archetypes",
    timingKey: "gmm",
    icon: CirclesThree,
    getInputContract: (meta) =>
      `Season-level per-90 aggregates for ${meta.testSeason} players meeting the 450-minute threshold.`,
    getOutputContract: () =>
      "BIC-selected k* Gaussian Mixture clusters per position with soft posterior role probabilities.",
    guarantee:
      "Full covariance matrices capture correlations across cost, xG, xA, CBIT, CBIRT, and DefCon hit rate.",
  },
  {
    id: "optimizer",
    title: "Simulated Annealing",
    subtitle: "Metropolis Search",
    module: "src/agents.py",
    anchor: "#optimizer",
    timingKey: "benchmark",
    icon: Flame,
    getInputContract: () =>
      "PlayerPool with availability-adjusted xP_base, calibrated P(DefCon), club IDs, and prices.",
    getOutputContract: () =>
      "Optimal 15-player squad maximizing exact Starting XI, captaincy, and 0.1x bench points under 5,000 evaluations.",
    guarantee:
      "Hard constraints enforce 100.0m budget, 2-5-5-3 positional quota, and max 3 players per club across 1-swap and 2-swap moves.",
  },
  {
    id: "backtest",
    title: "38-GW Backtest",
    subtitle: "1-FT Replay",
    module: "src/environment.py",
    anchor: "#backtest",
    timingKey: "backtest",
    icon: Trophy,
    getInputContract: (meta) =>
      `Weekly out-of-sample fixture predictions across all 38 gameweeks of ${meta.testSeason}.`,
    getOutputContract: () =>
      "Realised cumulative season points with weekly 1-free-transfer optimization, captaincy, and auto-subs.",
    guarantee:
      "Every weekly decision uses strictly pre-gameweek out-of-sample predictions before scoring realised match points.",
  },
];

const PORT_X = [100, 300, 500, 700, 900] as const;

function formatRuntime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0.00s";
  return seconds < 10 ? `${seconds.toFixed(2)}s` : `${seconds.toFixed(1)}s`;
}

/**
 * Interactive 5-stage architecture schematic with animated SVG signal paths and stage contracts.
 */
export function PipelineDiagram({ meta }: PipelineDiagramProps) {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const reduce = useReducedMotion();

  const activeStage = STAGES[activeIndex];
  const activeRuntime = meta.timingsS[activeStage.timingKey];
  const activePortX = PORT_X[activeIndex];

  return (
    <section
      id="pipeline"
      aria-labelledby="pipeline-heading"
      className="py-20 px-4 sm:px-6 max-w-7xl mx-auto scroll-mt-16"
    >
      <div>
        <h2
          id="pipeline-heading"
          className="font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight leading-[1.0] text-mist-50 text-balance"
        >
          Five Stages from Raw Fixtures to Realised Points
        </h2>
        <p className="mt-4 text-base text-mist-300 leading-relaxed max-w-[65ch] text-pretty">
          Select any node to inspect its input schema, Python engine module,
          output contract, and measured execution time.
        </p>
      </div>

      {/* Desktop SVG signal bus connecting the five selector nodes */}
      <div className="hidden lg:block mt-10 mb-2" aria-hidden="true">
        <svg
          viewBox="0 0 1000 64"
          className="w-full h-16 overflow-visible"
          fill="none"
        >
          <defs>
            <linearGradient id="pipeline-signal-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#74CBE9" />
              <stop offset="100%" stopColor="#C9023E" />
            </linearGradient>
          </defs>

          {/* Inactive baseline bus */}
          <line
            x1={PORT_X[0]}
            y1={24}
            x2={PORT_X[4]}
            y2={24}
            stroke="#2A2F52"
            strokeWidth={2}
          />

          {/* Subtle dashed flow across full pipeline */}
          {!reduce && (
            <motion.line
              x1={PORT_X[0]}
              y1={24}
              x2={PORT_X[4]}
              y2={24}
              stroke="#74CBE9"
              strokeOpacity={0.3}
              strokeWidth={2}
              strokeDasharray="6 10"
              animate={{ strokeDashoffset: [0, -32] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            />
          )}

          {/* Active upstream highlight up to selected stage */}
          <motion.line
            x1={PORT_X[0]}
            y1={24}
            y2={24}
            initial={false}
            animate={{
              x2: activePortX,
              opacity: activeIndex > 0 ? 1 : 0,
            }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }
            }
            stroke="url(#pipeline-signal-grad)"
            strokeWidth={3}
            strokeLinecap="round"
          />

          {/* Travelling telemetry pulse along active span */}
          {!reduce && activeIndex > 0 && (
            <motion.circle
              key={`pulse-${activeIndex}`}
              cy={24}
              r={4.5}
              fill="#E5225A"
              initial={{ cx: PORT_X[0], opacity: 0.9 }}
              animate={{
                cx: [PORT_X[0], activePortX],
                opacity: [0.35, 1, 0.35],
              }}
              transition={{
                duration: Math.max(1.1, activeIndex * 0.45),
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          )}

          {/* Stage ports and vertical drop stubs */}
          {PORT_X.map((x, idx) => {
            const isActive = idx === activeIndex;
            const isUpstream = idx < activeIndex;
            const strokeColor = isActive
              ? "#C9023E"
              : isUpstream
              ? "#74CBE9"
              : "#2A2F52";

            return (
              <g key={STAGES[idx].id}>
                <line
                  x1={x}
                  y1={24}
                  x2={x}
                  y2={62}
                  stroke={strokeColor}
                  strokeWidth={isActive ? 2.5 : 1.5}
                  strokeOpacity={isActive || isUpstream ? 0.9 : 0.7}
                />
                {isActive && !reduce && (
                  <motion.circle
                    cx={x}
                    cy={24}
                    r={11}
                    stroke="#C9023E"
                    strokeWidth={1.5}
                    initial={{ opacity: 0.7, scale: 0.8 }}
                    animate={{ opacity: 0, scale: 1.45 }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                  />
                )}
                <circle
                  cx={x}
                  cy={24}
                  r={isActive ? 7 : 5.5}
                  fill="#0A0C18"
                  stroke={strokeColor}
                  strokeWidth={2.5}
                />
                {isActive && (
                  <circle cx={x} cy={24} r={2.5} fill="#E5225A" />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 5 interactive stage selector nodes */}
      <div
        role="tablist"
        aria-label="Pipeline stages"
        className="mt-8 lg:mt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
      >
        {STAGES.map((stage, idx) => {
          const isActive = idx === activeIndex;
          const IconComponent = stage.icon;
          const runtime = meta.timingsS[stage.timingKey];

          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`pipeline-panel-${stage.id}`}
              onClick={() => setActiveIndex(idx)}
              className={[
                "group rounded-xl border p-4 text-left transition-all cursor-pointer active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                isActive
                  ? "border-crimson-500 bg-ink-800/90 shadow-[inset_0_1px_0_rgba(229,34,90,0.22)]"
                  : "border-ink-700 bg-ink-900 hover:border-mist-400/50 hover:bg-ink-800/60",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={[
                    "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                    isActive
                      ? "bg-crimson-950 border-crimson-500/60 text-crimson-400"
                      : "bg-ink-950 border-ink-700 text-spark-400 group-hover:text-mist-50",
                  ].join(" ")}
                >
                  <IconComponent size={18} weight="duotone" aria-hidden="true" />
                </span>

                <span className="font-mono text-xs tabular-nums text-mist-300">
                  {formatRuntime(runtime)}
                </span>
              </div>

              <h3 className="mt-3 font-sans text-sm font-semibold text-mist-50 leading-snug">
                {stage.title}
              </h3>

              <p className="mt-1 font-mono text-[11px] text-mist-400">
                {stage.subtitle}
              </p>
            </button>
          );
        })}
      </div>

      {/* Stage contract inspector */}
      <div className="mt-5 rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStage.id}
            id={`pipeline-panel-${activeStage.id}`}
            role="tabpanel"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-display text-2xl sm:text-3xl font-bold uppercase tracking-tight text-mist-50">
                  {activeStage.title}
                </h3>

                <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-950 px-3 py-1 font-mono text-xs text-spark-400">
                  <Code size={13} weight="bold" aria-hidden="true" />
                  <span>{activeStage.module}</span>
                </span>

                <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-950 px-3 py-1 font-mono text-xs tabular-nums text-mist-300">
                  <Clock size={13} weight="bold" aria-hidden="true" />
                  <span>Runtime: {formatRuntime(activeRuntime)}</span>
                </span>
              </div>

              <a
                href={activeStage.anchor}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-950 hover:border-crimson-400/70 hover:bg-ink-800 text-mist-50 px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
              >
                <span>Jump to Section</span>
                <ArrowDown size={13} weight="bold" aria-hidden="true" />
              </a>
            </div>

            <div className="mt-5 pt-5 border-t border-ink-700 grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <p className="font-mono text-xs text-mist-400">
                  Input Contract
                </p>
                <p className="mt-1.5 text-sm text-mist-300 leading-relaxed">
                  {activeStage.getInputContract(meta)}
                </p>
              </div>

              <div>
                <p className="font-mono text-xs text-mist-400">
                  Output Contract
                </p>
                <p className="mt-1.5 text-sm text-mist-50 leading-relaxed">
                  {activeStage.getOutputContract(meta)}
                </p>
              </div>

              <div>
                <p className="font-mono text-xs text-mist-400">
                  Architectural Guarantee
                </p>
                <p className="mt-1.5 text-sm text-mist-300 leading-relaxed">
                  {activeStage.guarantee}
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
