"use client";

import React, { useMemo, useState } from "react";
import { ChartScatter, Sparkle } from "@phosphor-icons/react";
import type { GmmPlayerPoint, WorkflowDataset } from "../../lib/workflowTypes";
import { MathDisclosure } from "./MathDisclosure";

export interface ArchetypesBentoSectionProps {
  gmm: WorkflowDataset["gmm"];
  dataMode: "live" | "snapshot";
}

type OutfieldPos = "DEF" | "MID" | "FWD";
type BicPos = "GK" | "DEF" | "MID" | "FWD";

const CLUSTER_PALETTE = [
  "#C9023E",
  "#74CBE9",
  "#6C8CF0",
  "#E2A64A",
  "#A9A5C6",
] as const;

function getRoleBucket(
  p: GmmPlayerPoint
): "DefCon Anchors" | "Attacking Wing-Backs" | "Premium Captains" {
  const arch = p.archetype.toLowerCase();
  if (
    arch.includes("cbit") ||
    arch.includes("defcon") ||
    arch.includes("anchor") ||
    arch.includes("pressing")
  ) {
    return "DefCon Anchors";
  }
  if (
    arch.includes("wing-back") ||
    arch.includes("attacking") ||
    arch.includes("playmaker") ||
    arch.includes("winger") ||
    arch.includes("creative") ||
    arch.includes("value striker")
  ) {
    return "Attacking Wing-Backs";
  }
  if (arch.includes("premium")) {
    return "Premium Captains";
  }
  if (p.pDefconAnchor >= p.pAttackingOutlet) {
    return "DefCon Anchors";
  }
  return p.position === "DEF" ? "Attacking Wing-Backs" : "Premium Captains";
}

/**
 * 4-cell asymmetric Bento showcase for GMM tactical archetypes and BIC selection.
 */
export function ArchetypesBentoSection({
  gmm,
  dataMode,
}: ArchetypesBentoSectionProps) {
  const [scatterPos, setScatterPos] = useState<OutfieldPos>("DEF");
  const [bicPos, setBicPos] = useState<BicPos>("DEF");
  const [hoveredElement, setHoveredElement] = useState<number | null>(null);
  const [pinnedElement, setPinnedElement] = useState<number | null>(null);

  const handleScatterPosChange = (nextPos: OutfieldPos) => {
    setScatterPos(nextPos);
    setBicPos(nextPos);
    setHoveredElement(null);
    setPinnedElement(null);
  };

  // Filtered scatter pool for active outfield position
  const filteredPlayers = useMemo(
    () =>
      gmm.players.filter(
        (p) =>
          p.position === scatterPos &&
          p.archetype &&
          p.archetype !== "Unclassified"
      ),
    [gmm.players, scatterPos]
  );

  // Archetype color map sorted deterministically
  const archetypeColors = useMemo(() => {
    const unique = Array.from(
      new Set(filteredPlayers.map((p) => p.archetype))
    ).sort();
    const map = new Map<string, string>();
    unique.forEach((name, idx) => {
      map.set(name, CLUSTER_PALETTE[idx % CLUSTER_PALETTE.length]);
    });
    return { unique, map };
  }, [filteredPlayers]);

  // Scatter SVG geometry
  const scatterGeom = useMemo(() => {
    const w = 640;
    const h = 300;
    const pad = { top: 20, right: 20, bottom: 40, left: 52 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const maxRate = Math.max(
      ...filteredPlayers.map((p) => p.defconHitRate * 100),
      35
    );
    const maxX = Math.min(100, Math.ceil(maxRate / 10) * 10 + 5);
    const maxAtt = Math.max(
      ...filteredPlayers.map((p) => p.xgPer90 + p.xaPer90),
      0.5
    );
    const maxY = Math.ceil(maxAtt * 10) / 10 + 0.1;

    const xOf = (hitRatePct: number) =>
      pad.left + (Math.min(Math.max(hitRatePct, 0), maxX) / maxX) * iw;
    const yOf = (xgXa: number) =>
      pad.top + ih - (Math.min(Math.max(xgXa, 0), maxY) / maxY) * ih;
    const rOf = (cost: number) => {
      const norm = Math.min(Math.max((cost - 3.8) / 10.5, 0), 1);
      return 3.5 + norm * 6.0;
    };

    const ticksX = [0, maxX * 0.25, maxX * 0.5, maxX * 0.75, maxX].map((v) =>
      Math.round(v)
    );
    const ticksY = [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY].map((v) =>
      Number(v.toFixed(2))
    );

    return { w, h, pad, iw, ih, maxX, maxY, xOf, yOf, rOf, ticksX, ticksY };
  }, [filteredPlayers]);

  // Default inspected player when nothing hovered/pinned
  const activePlayer = useMemo(() => {
    const targetId = hoveredElement ?? pinnedElement;
    if (targetId !== null) {
      const found = filteredPlayers.find((p) => p.element === targetId);
      if (found) return found;
    }
    const spotlightMatch = gmm.spotlights.find(
      (p) => p.position === scatterPos
    );
    if (spotlightMatch) return spotlightMatch;
    if (filteredPlayers.length === 0) return null;
    return [...filteredPlayers].sort((a, b) => b.totalPoints - a.totalPoints)[0];
  }, [
    hoveredElement,
    pinnedElement,
    filteredPlayers,
    gmm.spotlights,
    scatterPos,
  ]);

  // Cell 2: BIC curve geometry
  const bicData = useMemo(() => {
    const row = gmm.summary.find((s) => s.position === bicPos);
    const entries = row
      ? Object.entries(row.bic)
          .map(([kStr, val]) => ({ k: Number(kStr), bic: val }))
          .filter((d) => Number.isFinite(d.k) && Number.isFinite(d.bic))
          .sort((a, b) => a.k - b.k)
      : [];

    const w = 440;
    const h = 230;
    const pad = { top: 24, right: 24, bottom: 38, left: 54 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const minBic = entries.length
      ? Math.min(...entries.map((e) => e.bic))
      : 0;
    const maxBic = entries.length
      ? Math.max(...entries.map((e) => e.bic))
      : 100;
    const span = Math.max(maxBic - minBic, 40);
    const yLo = Math.floor((minBic - span * 0.12) / 10) * 10;
    const yHi = Math.ceil((maxBic + span * 0.12) / 10) * 10;

    const xOf = (idx: number) =>
      entries.length <= 1
        ? pad.left + iw / 2
        : pad.left + (idx / (entries.length - 1)) * iw;
    const yOf = (val: number) =>
      pad.top + ih - ((val - yLo) / Math.max(yHi - yLo, 1)) * ih;

    const bestEntry =
      entries.find((e) => e.k === row?.k) ??
      (entries.length
        ? entries.reduce((best, cur) => (cur.bic < best.bic ? cur : best))
        : null);

    return { row, entries, w, h, pad, iw, ih, yLo, yHi, xOf, yOf, bestEntry };
  }, [gmm.summary, bicPos]);

  // Cell 4: Role-grouped spotlights (guaranteeing all 3 role groups show real players)
  const groupedSpotlights = useMemo(() => {
    const groups: Record<
      "DefCon Anchors" | "Attacking Wing-Backs" | "Premium Captains",
      GmmPlayerPoint[]
    > = {
      "DefCon Anchors": [],
      "Attacking Wing-Backs": [],
      "Premium Captains": [],
    };

    const seen = new Set<number>();
    for (const p of gmm.spotlights) {
      if (seen.has(p.element)) continue;
      seen.add(p.element);
      const bucket = getRoleBucket(p);
      groups[bucket].push(p);
    }

    // Fill any empty tactical role cleanly from gmm.players if spotlight subset lacked one
    const fallbackBuckets: (keyof typeof groups)[] = [
      "DefCon Anchors",
      "Attacking Wing-Backs",
      "Premium Captains",
    ];
    for (const bucket of fallbackBuckets) {
      if (groups[bucket].length === 0) {
        const cand = gmm.players
          .filter((p) => !seen.has(p.element) && getRoleBucket(p) === bucket)
          .sort((a, b) => b.totalPoints - a.totalPoints)
          .slice(0, 2);
        for (const c of cand) {
          seen.add(c.element);
          groups[bucket].push(c);
        }
      }
    }

    return fallbackBuckets.map((title) => ({
      title,
      players: groups[title].slice(0, 3),
    }));
  }, [gmm.spotlights, gmm.players]);

  return (
    <section
      id="archetypes"
      aria-labelledby="archetypes-heading"
      className="py-20 px-4 sm:px-6 max-w-7xl mx-auto w-full"
    >
      {/* Stacked section header (ZERO eyebrow) */}
      <div className="max-w-[65ch]">
        <h2
          id="archetypes-heading"
          className="font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50"
        >
          Probabilistic Tactical Archetypes
        </h2>
        <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed">
          Full-covariance Gaussian Mixture Models uncover latent outfield roles
          and assign soft membership posteriors instead of rigid labels.
        </p>
      </div>

      {/* Exact 4-cell Asymmetric Bento Grid */}
      <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Cell 1: GMM Player Scatter (col-span-7) */}
        <div className="lg:col-span-7 bg-ink-900 border border-ink-700 rounded-2xl p-5 sm:p-6 min-w-0 flex flex-col justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-mist-50">
                <ChartScatter
                  size={18}
                  weight="bold"
                  aria-hidden="true"
                  className="text-crimson-400 shrink-0"
                />
                <h3 className="text-sm font-semibold tracking-tight">
                  GMM Player Scatter
                </h3>
              </div>
              <p className="mt-0.5 text-xs text-mist-300">
                X: DefCon Hit Rate % | Y: xG + xA / 90 | Radius: Price
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Live vs Snapshot indicator badge */}
              <span
                className={[
                  "rounded-full px-3 py-1 text-[11px] font-mono font-semibold border whitespace-nowrap",
                  dataMode === "live"
                    ? "border-crimson-500/50 bg-crimson-950/70 text-mist-50"
                    : "border-ink-700 bg-ink-950 text-spark-400",
                ].join(" ")}
              >
                {dataMode === "live"
                  ? "Live API Pool"
                  : "Verified 2025-26 Snapshot"}
              </span>

              {/* Position filter pills */}
              <div
                role="group"
                aria-label="Scatter position filter"
                className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-950 p-1"
              >
                {(["DEF", "MID", "FWD"] as const).map((pos) => {
                  const active = scatterPos === pos;
                  return (
                    <button
                      key={pos}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleScatterPosChange(pos)}
                      className={[
                        "rounded-full px-3 py-1 text-xs font-mono font-semibold transition-colors cursor-pointer",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                        active
                          ? "bg-crimson-500 text-mist-50"
                          : "text-mist-300 hover:text-mist-50",
                      ].join(" ")}
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Interactive SVG scatter plot */}
          <div className="rounded-xl border border-ink-700 bg-ink-950 p-2 sm:p-3 overflow-hidden">
            <svg
              viewBox={`0 0 ${scatterGeom.w} ${scatterGeom.h}`}
              role="img"
              aria-label={`Gaussian Mixture player scatter plot for ${scatterPos} showing DefCon hit rate versus expected goal involvements per 90 minutes`}
              className="w-full h-auto block select-none"
            >
              {/* Gridlines */}
              {scatterGeom.ticksY.map((t) => {
                const y = scatterGeom.yOf(t);
                return (
                  <g key={`y-${t}`}>
                    <line
                      x1={scatterGeom.pad.left}
                      x2={scatterGeom.w - scatterGeom.pad.right}
                      y1={y}
                      y2={y}
                      stroke="#2A2F52"
                      strokeDasharray="3 4"
                      strokeWidth={1}
                    />
                    <text
                      x={scatterGeom.pad.left - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-mist-300 text-[10px] font-mono"
                    >
                      {t.toFixed(2)}
                    </text>
                  </g>
                );
              })}

              {scatterGeom.ticksX.map((t) => {
                const x = scatterGeom.xOf(t);
                return (
                  <g key={`x-${t}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={scatterGeom.pad.top}
                      y2={scatterGeom.pad.top + scatterGeom.ih}
                      stroke="#2A2F52"
                      strokeDasharray="3 4"
                      strokeWidth={1}
                    />
                    <text
                      x={x}
                      y={scatterGeom.h - 18}
                      textAnchor="middle"
                      className="fill-mist-300 text-[10px] font-mono"
                    >
                      {t}%
                    </text>
                  </g>
                );
              })}

              {/* Axis labels */}
              <text
                x={scatterGeom.pad.left + scatterGeom.iw / 2}
                y={scatterGeom.h - 4}
                textAnchor="middle"
                className="fill-mist-300 text-[10px] font-mono"
              >
                DefCon Hit Rate (%)
              </text>
              <text
                x={14}
                y={scatterGeom.pad.top + scatterGeom.ih / 2}
                transform={`rotate(-90 14 ${
                  scatterGeom.pad.top + scatterGeom.ih / 2
                })`}
                textAnchor="middle"
                className="fill-mist-300 text-[10px] font-mono"
              >
                xG + xA per 90
              </text>

              {/* Player dots */}
              {filteredPlayers.map((p) => {
                const cx = scatterGeom.xOf(p.defconHitRate * 100);
                const cy = scatterGeom.yOf(p.xgPer90 + p.xaPer90);
                const r = scatterGeom.rOf(p.cost);
                const fill =
                  archetypeColors.map.get(p.archetype) ?? "#A9A5C6";
                const isActive = activePlayer?.element === p.element;
                return (
                  <circle
                    key={p.element}
                    cx={cx}
                    cy={cy}
                    r={isActive ? r + 1.8 : r}
                    fill={fill}
                    fillOpacity={isActive ? 0.98 : 0.72}
                    stroke={isActive ? "#EEEAF4" : "#0A0C18"}
                    strokeWidth={isActive ? 1.8 : 0.9}
                    tabIndex={0}
                    role="button"
                    aria-label={`${p.name}, ${p.archetype}, ${p.cost.toFixed(
                      1
                    )}m`}
                    className="cursor-pointer focus:outline-none"
                    onMouseEnter={() => setHoveredElement(p.element)}
                    onMouseLeave={() => setHoveredElement(null)}
                    onFocus={() => setHoveredElement(p.element)}
                    onClick={() => setPinnedElement(p.element)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPinnedElement(p.element);
                      }
                    }}
                  />
                );
              })}
            </svg>
          </div>

          {/* Inline player inspection readout bar */}
          <div className="rounded-xl border border-ink-700 bg-ink-950/90 px-4 py-3">
            {activePlayer ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-mist-50 truncate">
                      {activePlayer.name}
                    </span>
                    {activePlayer.teamShort && (
                      <span className="rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] font-mono text-mist-300">
                        {activePlayer.teamShort}
                      </span>
                    )}
                    <span className="text-xs font-mono text-spark-400 tabular-nums">
                      £{activePlayer.cost.toFixed(1)}m
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-mist-300">
                    Archetype:{" "}
                    <span className="text-mist-50 font-medium">
                      {activePlayer.archetype}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums shrink-0">
                  <div>
                    <div className="text-[10px] text-mist-300">Confidence</div>
                    <div className="font-semibold text-mist-50">
                      {(activePlayer.confidence * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mist-300">P(Anchor)</div>
                    <div className="font-semibold text-crimson-400">
                      {(activePlayer.pDefconAnchor * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mist-300">P(Outlet)</div>
                    <div className="font-semibold text-spark-400">
                      {(activePlayer.pAttackingOutlet * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-mist-300">
                Hover or tap any player bubble to inspect cluster posteriors.
              </p>
            )}
          </div>

          {/* Cluster legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-mono text-mist-300">
            {archetypeColors.unique.map((arch) => (
              <span key={arch} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      archetypeColors.map.get(arch) ?? "#A9A5C6",
                  }}
                />
                {arch}
              </span>
            ))}
          </div>
        </div>

        {/* Cell 2: BIC Model Selection Curve (col-span-5, subtle crimson tint) */}
        <div
          className="lg:col-span-5 bg-ink-950 border border-ink-700 rounded-2xl p-5 sm:p-6 min-w-0 relative overflow-hidden flex flex-col justify-between gap-4"
          style={{
            backgroundImage:
              "radial-gradient(circle at 88% 12%, rgba(201, 2, 62, 0.16), transparent 62%)",
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-mist-50">
                BIC Model Selection Curve
              </h3>
              <p className="mt-0.5 text-xs text-mist-300">
                Minimum Bayesian Information Criterion picks k*
              </p>
            </div>

            <div
              role="group"
              aria-label="BIC position selector"
              className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900 p-1 self-start sm:self-auto"
            >
              {(["DEF", "MID", "FWD", "GK"] as const).map((pos) => {
                const active = bicPos === pos;
                return (
                  <button
                    key={pos}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setBicPos(pos)}
                    className={[
                      "rounded-full px-2.5 py-1 text-[11px] font-mono font-semibold transition-colors cursor-pointer",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
                      active
                        ? "bg-crimson-500 text-mist-50"
                        : "text-mist-300 hover:text-mist-50",
                    ].join(" ")}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
          </div>

          {/* BIC SVG Plot */}
          <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-2.5 overflow-hidden">
            <svg
              viewBox={`0 0 ${bicData.w} ${bicData.h}`}
              role="img"
              aria-label={`BIC curve for ${bicPos} selecting optimal cluster count k* equals ${
                bicData.bestEntry?.k ?? 2
              }`}
              className="w-full h-auto block select-none"
            >
              {/* Horizontal gridlines */}
              {[0, 0.5, 1].map((frac) => {
                const val =
                  bicData.yLo + frac * (bicData.yHi - bicData.yLo);
                const y = bicData.yOf(val);
                return (
                  <g key={frac}>
                    <line
                      x1={bicData.pad.left}
                      x2={bicData.w - bicData.pad.right}
                      y1={y}
                      y2={y}
                      stroke="#2A2F52"
                      strokeDasharray="3 4"
                      strokeWidth={1}
                    />
                    <text
                      x={bicData.pad.left - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-mist-300 text-[10px] font-mono"
                    >
                      {Math.round(val)}
                    </text>
                  </g>
                );
              })}

              {/* Connecting line when >= 2 tested k */}
              {bicData.entries.length >= 2 && (
                <polyline
                  fill="none"
                  stroke="#74CBE9"
                  strokeWidth={2.2}
                  points={bicData.entries
                    .map(
                      (e, i) =>
                        `${bicData.xOf(i).toFixed(1)},${bicData
                          .yOf(e.bic)
                          .toFixed(1)}`
                    )
                    .join(" ")}
                />
              )}

              {/* Optimal k* vertical marker and nodes */}
              {bicData.entries.map((e, i) => {
                const x = bicData.xOf(i);
                const y = bicData.yOf(e.bic);
                const isBest = bicData.bestEntry?.k === e.k;
                return (
                  <g key={e.k}>
                    {isBest && (
                      <>
                        <line
                          x1={x}
                          x2={x}
                          y1={y}
                          y2={bicData.pad.top + bicData.ih}
                          stroke="#E5225A"
                          strokeDasharray="4 3"
                          strokeWidth={1.3}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r={10}
                          fill="#C9023E"
                          fillOpacity={0.22}
                        />
                      </>
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={isBest ? 5.5 : 3.8}
                      fill={isBest ? "#E5225A" : "#74CBE9"}
                      stroke="#0A0C18"
                      strokeWidth={1.5}
                    />
                    <text
                      x={x}
                      y={bicData.h - 14}
                      textAnchor="middle"
                      className={
                        isBest
                          ? "fill-mist-50 text-[11px] font-mono font-bold"
                          : "fill-mist-300 text-[10px] font-mono"
                      }
                    >
                      k={e.k}
                    </text>
                  </g>
                );
              })}

              <text
                x={14}
                y={bicData.pad.top + bicData.ih / 2}
                transform={`rotate(-90 14 ${
                  bicData.pad.top + bicData.ih / 2
                })`}
                textAnchor="middle"
                className="fill-mist-300 text-[10px] font-mono"
              >
                BIC (lower is better)
              </text>
            </svg>
          </div>

          {/* Optimal k* & discovered archetypes */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums border-b border-ink-700 pb-2.5">
              <span className="text-mist-300">
                Selected {bicPos} Clusters
              </span>
              <span className="text-crimson-400 font-semibold">
                k* = {bicData.bestEntry?.k ?? bicData.row?.k ?? 2} (BIC{" "}
                {bicData.bestEntry ? bicData.bestEntry.bic.toFixed(1) : "n/a"})
              </span>
            </div>

            {bicPos === "GK" && bicData.entries.length <= 1 && (
              <p className="text-[11px] text-mist-300">
                Sample-size cap restricts full-covariance sweep for goalkeepers
                to k = 2.
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {(bicData.row?.archetypes ?? []).map((arch) => (
                <span
                  key={arch}
                  className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-1 text-[11px] font-mono text-mist-300"
                >
                  {arch}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Cell 3: Editorial Artwork Frame (col-span-5) */}
        <div className="lg:col-span-5 bg-ink-900 border border-ink-700 rounded-2xl p-5 min-w-0 flex flex-col justify-between gap-4">
          <div className="rounded-xl overflow-hidden aspect-[4/3] border border-ink-700 bg-ink-950">
            <img
              src="/media/workflow-archetypes.png"
              alt="Three translucent Gaussian Mixture probability ellipsoids suspended in obsidian space"
              className="w-full h-full object-cover block"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-spark-400">
              <Sparkle size={14} weight="bold" aria-hidden="true" />
              <span>Full-Covariance Soft Posteriors</span>
            </div>
            <p className="text-xs sm:text-sm text-mist-300 leading-relaxed">
              Standardized per-90 features feed full-covariance Expectation
              Maximization, allowing hybrid wing-backs and box-to-box midfielders
              to carry continuous probability across multiple roles.
            </p>
          </div>
        </div>

        {/* Cell 4: Soft-Clustered Player Spotlights + MathDisclosure (col-span-7) */}
        <div className="lg:col-span-7 bg-ink-900 border border-ink-700 rounded-2xl p-5 sm:p-6 min-w-0 flex flex-col justify-between gap-5">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-mist-50">
              Soft-Clustered Player Spotlights
            </h3>
            <p className="mt-1 text-xs text-mist-300">
              Real 2025-26 profiles grouped by tactical role with posterior
              weights for defensive floor versus attacking upside.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {groupedSpotlights.map((group) => (
                <div key={group.title} className="space-y-2.5 min-w-0">
                  <div className="pb-1.5 border-b border-ink-700 text-[11px] font-mono font-semibold uppercase tracking-wider text-mist-300">
                    {group.title}
                  </div>
                  <div className="space-y-2.5">
                    {group.players.map((p) => {
                      const anchorPct = Math.round(p.pDefconAnchor * 100);
                      const outletPct = Math.round(p.pAttackingOutlet * 100);
                      const confPct = Math.round(p.confidence * 100);
                      const totalPosterior = Math.max(
                        anchorPct + outletPct,
                        1
                      );
                      const anchorShare =
                        (anchorPct / totalPosterior) * 100;

                      return (
                        <div
                          key={p.element}
                          className="rounded-xl border border-ink-700/85 bg-ink-950/75 p-3 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-mist-50 truncate">
                                {p.name}
                              </div>
                              <div className="text-[11px] font-mono text-mist-300 tabular-nums">
                                {p.teamShort ?? p.position} | £
                                {p.cost.toFixed(1)}m
                              </div>
                            </div>
                            <span className="text-[11px] font-mono font-semibold text-mist-50 tabular-nums shrink-0">
                              {confPct}%
                            </span>
                          </div>

                          <div className="text-[11px] text-mist-300 truncate">
                            {p.archetype}
                          </div>

                          {/* Minimal SVG posterior split hairline */}
                          <svg
                            viewBox="0 0 180 6"
                            aria-hidden="true"
                            className="w-full h-1.5 block"
                          >
                            <rect
                              x={0}
                              y={1}
                              width={180}
                              height={4}
                              rx={2}
                              fill="#1A1E3A"
                            />
                            {anchorPct > 0 && (
                              <rect
                                x={0}
                                y={1}
                                width={Math.max((180 * anchorShare) / 100, 3)}
                                height={4}
                                rx={2}
                                fill="#C9023E"
                              />
                            )}
                            {outletPct > 0 && (
                              <rect
                                x={
                                  anchorPct > 0
                                    ? Math.min((180 * anchorShare) / 100 + 2, 176)
                                    : 0
                                }
                                y={1}
                                width={
                                  anchorPct > 0
                                    ? Math.max(
                                        180 - (180 * anchorShare) / 100 - 2,
                                        3
                                      )
                                    : 180
                                }
                                height={4}
                                rx={2}
                                fill="#74CBE9"
                              />
                            )}
                          </svg>

                          <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-mist-300">
                            <span>Anc {anchorPct}%</span>
                            <span>Out {outletPct}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <MathDisclosure title="Inspect the Math: EM Full-Covariance GMM and BIC Penalty">
            <p>
              <strong className="text-mist-50">
                Expectation-Maximization with Full Covariance:
              </strong>{" "}
              For each position with at least 450 played minutes, z-scored
              per-90 telemetry vectors{" "}
              <code className="font-mono text-mist-50">z_i</code> are fit using{" "}
              <code className="font-mono text-spark-400">
                GaussianMixture(covariance_type=&quot;full&quot;, n_init=5,
                reg_covar=1e-2)
              </code>
              . Each cluster <code className="font-mono text-mist-50">c</code>{" "}
              learns its own mean{" "}
              <code className="font-mono text-mist-50">mu_c</code> and full{" "}
              <code className="font-mono text-mist-50">d x d</code> covariance
              matrix <code className="font-mono text-mist-50">Sigma_c</code>.
            </p>
            <p>
              <strong className="text-mist-50">BIC Complexity Penalty:</strong>{" "}
              Cluster count{" "}
              <code className="font-mono text-mist-50">k*</code> minimizes{" "}
              <code className="font-mono text-crimson-400">
                BIC(k) = -2 * log L_k + p_k * log(N)
              </code>
              , where{" "}
              <code className="font-mono text-mist-50">
                p_k = k * (d + d(d+1)/2) + (k - 1)
              </code>{" "}
              penalizes excess covariance parameters and caps{" "}
              <code className="font-mono text-mist-50">k</code> below{" "}
              <code className="font-mono text-mist-50">N / per_comp</code> to
              prevent overfitting small positional pools.
            </p>
          </MathDisclosure>
        </div>
      </div>
    </section>
  );
}

export default ArchetypesBentoSection;
