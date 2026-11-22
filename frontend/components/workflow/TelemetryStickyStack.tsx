"use client";

import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  CaretDown,
  CaretUp,
  Database,
  LockKey,
  ShieldCheck,
  Stack,
} from "@phosphor-icons/react";
import type { WorkflowDataset } from "../../lib/workflowTypes";

gsap.registerPlugin(ScrollTrigger);

export interface TelemetryStickyStackProps {
  meta: WorkflowDataset["meta"];
}

const FEATURE_GROUPS = [
  {
    name: "Rolling 3 & 5 Form",
    cols: "26 cols",
    detail:
      "minutes, total_points, xg, xa, xgc, bps, bonus, starts, clean_sheets, cbit, cbirt, defcon, defcon_hit",
  },
  {
    name: "Per-90 Rates",
    cols: "5 cols",
    detail:
      "xg_per90, xa_per90, xgc_per90, cbit_per90, cbirt_per90 over 5-match rolling minutes",
  },
  {
    name: "Team xG Share",
    cols: "6 cols",
    detail:
      "team_xg_roll, team_xga_roll, team_xg_share plus opp_team_xg_roll, opp_team_xga_roll, opp_team_xg_share",
  },
  {
    name: "Venue FDR & Strength",
    cols: "11 cols",
    detail:
      "was_home, fdr, value, opp_strength_attack/defence, own_strength_attack/defence, pos_GK/DEF/MID/FWD",
  },
  {
    name: "Season PPM & Targets",
    cols: "35 cols",
    detail:
      "ppm_season (reset each season), matches_played, raw match stats, defcon_points, and target_base",
  },
] as const;

const DEFCON_THRESHOLDS = [
  {
    position: "DEF",
    rule: ">= 10 CBIT",
    formula: "Clearances + Blocks + Interceptions + Tackles",
    reward: "+2 DefCon bonus",
    borderClass: "border-spark-400/40",
    accentClass: "text-spark-400",
  },
  {
    position: "MID & FWD",
    rule: ">= 12 CBIRT",
    formula: "CBIT + Ball Recoveries",
    reward: "+2 DefCon bonus",
    borderClass: "border-cobalt-400/40",
    accentClass: "text-cobalt-400",
  },
  {
    position: "GK",
    rule: "Ineligible",
    formula: "Excluded from DefCon threshold scoring",
    reward: "P(DefCon Hit) = 0.00",
    borderClass: "border-ink-700",
    accentClass: "text-mist-400",
  },
] as const;

/**
 * Pure GSAP + ScrollTrigger 3-card sticky stack explaining feature engineering and DefCon decoupling.
 */
export function TelemetryStickyStack({ meta }: TelemetryStickyStackProps) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [showFeatures, setShowFeatures] = useState(false);

  useEffect(() => {
    if (!stackRef.current) return;

    const mm = gsap.matchMedia();
    mm.add(
      "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
      () => {
        const cards = gsap.utils.toArray<HTMLElement>(
          ".stack-card",
          stackRef.current
        );
        cards.forEach((card, i) => {
          if (i === cards.length - 1) return;

          ScrollTrigger.create({
            trigger: card,
            start: "top top",
            endTrigger: cards[cards.length - 1],
            end: "top top",
            pin: true,
            pinSpacing: false,
          });

          gsap.to(card, {
            scale: 0.94,
            opacity: 0.55,
            ease: "none",
            scrollTrigger: {
              trigger: cards[i + 1],
              start: "top bottom",
              end: "top top",
              scrub: true,
            },
          });
        });
      }
    );

    return () => {
      mm.revert();
    };
  }, []);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia(
        "(min-width: 768px) and (prefers-reduced-motion: no-preference)"
      ).matches
    ) {
      const rafId = window.requestAnimationFrame(() => {
        ScrollTrigger.refresh();
      });
      return () => window.cancelAnimationFrame(rafId);
    }
    return undefined;
  }, [showFeatures]);

  return (
    <section
      id="telemetry"
      aria-labelledby="telemetry-heading"
      className="py-20 px-4 sm:px-6 max-w-7xl mx-auto scroll-mt-16"
    >
      <div>
        <h2
          id="telemetry-heading"
          className="font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight leading-[1.0] text-mist-50 text-balance"
        >
          Leakage-Free Feature Engineering
        </h2>
        <p className="mt-4 text-base text-mist-300 leading-relaxed max-w-[65ch] text-pretty">
          Historical CSVs and live FPL endpoints feed one shared FeatureEngineer
          behind a strict temporal cutoff.
        </p>
      </div>

      <div ref={stackRef} className="mt-10 relative space-y-6 md:space-y-0">
        {/* Card 1: Four Seasons of Match Telemetry */}
        <article className="stack-card relative z-10 md:min-h-[82dvh] md:pt-20 md:pb-8 flex items-center">
          <div className="w-full rounded-2xl border border-ink-700 bg-ink-900 p-6 sm:p-8 lg:p-10 shadow-[0_24px_70px_rgba(4,6,16,0.7)]">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-950 px-3 py-1 text-xs font-mono text-spark-400">
                  <Database size={14} weight="duotone" aria-hidden="true" />
                  <span>HistoricalDataLoader + FPLApiClient</span>
                </div>

                <h3 className="mt-4 font-display text-3xl sm:text-4xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50">
                  Four Seasons of Match Telemetry
                </h3>

                <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed">
                  Offline experiments ingest Vaastav match CSVs across{" "}
                  <span className="text-mist-50 font-medium">2022-23</span>{" "}
                  through{" "}
                  <span className="text-mist-50 font-medium">
                    {meta.testSeason}
                  </span>
                  , while live runs query the official FPL API through an async{" "}
                  <code className="font-mono text-xs text-spark-400">
                    httpx
                  </code>{" "}
                  TTL cache with disk snapshot fallback in{" "}
                  <code className="font-mono text-xs text-mist-300">
                    data/cache/
                  </code>
                  .
                </p>

                <div className="mt-6 pt-5 border-t border-ink-700 grid grid-cols-3 gap-4">
                  <div>
                    <p className="font-mono text-[11px] text-mist-400">
                      Player-Fixtures
                    </p>
                    <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular-nums text-mist-50">
                      {meta.totalRecords.toLocaleString("en-US")}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[11px] text-mist-400">
                      Schema Columns
                    </p>
                    <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular-nums text-spark-400">
                      {meta.engineeredColumns}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[11px] text-mist-400">
                      OOS Holdout
                    </p>
                    <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular-nums text-crimson-400">
                      {meta.oosFixtures.toLocaleString("en-US")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6">
                <div className="rounded-xl overflow-hidden border border-ink-700 bg-ink-950 aspect-[16/9]">
                  <img
                    src="/media/workflow-telemetry.png"
                    alt="Translucent obsidian layers with glowing blue data streams terminating at a crimson temporal barrier"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* Card 2: The shift(1) Temporal Barrier */}
        <article className="stack-card relative z-20 md:min-h-[82dvh] md:pt-20 md:pb-8 flex items-center">
          <div className="w-full rounded-2xl border border-ink-700 bg-ink-900 p-6 sm:p-8 lg:p-10 shadow-[0_24px_70px_rgba(4,6,16,0.7)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-crimson-500/40 bg-crimson-950 px-3 py-1 text-xs font-mono text-crimson-400">
                  <LockKey size={14} weight="duotone" aria-hidden="true" />
                  <span>shift(1) per player_key &amp; team_id</span>
                </div>

                <h3 className="mt-4 font-display text-3xl sm:text-4xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50">
                  The shift(1) Temporal Barrier
                </h3>

                <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed">
                  Every rolling average, per-90 rate, and team xG share is
                  computed post-match and shifted backward by one fixture,
                  preventing same-match stats from leaking into predictions.
                </p>
              </div>

              <button
                type="button"
                aria-expanded={showFeatures}
                onClick={() => setShowFeatures((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-950 hover:border-spark-400/60 hover:bg-ink-800 text-mist-50 px-4 py-2 text-xs font-semibold sm:whitespace-nowrap max-w-full text-left transition-colors cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
              >
                <Stack size={15} weight="duotone" className="shrink-0" aria-hidden="true" />
                <span>Inspect 83-Column Feature Groups</span>
                {showFeatures ? (
                  <CaretUp size={14} weight="bold" className="shrink-0" aria-hidden="true" />
                ) : (
                  <CaretDown size={14} weight="bold" className="shrink-0" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* Custom responsive SVG timeline illustrating shift(1) cutoff */}
            <div className="mt-6 rounded-xl border border-ink-700 bg-ink-950 p-3 sm:p-4">
              <svg
                viewBox="0 0 880 185"
                role="img"
                aria-label="Timeline showing historical fixtures t-5 through t-1 before the crimson shift(1) barrier and target fixture t after the barrier"
                className="w-full h-auto"
                fill="none"
              >
                {/* 5-match rolling window bracket */}
                <path
                  d="M 48 36 L 48 26 L 604 26 L 604 36"
                  stroke="#6C8CF0"
                  strokeWidth={1.5}
                />
                <text
                  x={326}
                  y={18}
                  textAnchor="middle"
                  fill="#6C8CF0"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  roll5 + per90 window (strictly prior matches)
                </text>

                {/* 3-match rolling window bracket */}
                <path
                  d="M 280 58 L 280 48 L 604 48 L 604 58"
                  stroke="#74CBE9"
                  strokeWidth={1.5}
                />
                <text
                  x={442}
                  y={44}
                  textAnchor="middle"
                  fill="#74CBE9"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  roll3 recent form window
                </text>

                {/* Horizontal match timeline spine */}
                <line
                  x1={48}
                  y1={104}
                  x2={832}
                  y2={104}
                  stroke="#2A2F52"
                  strokeWidth={2}
                />

                {/* Historical matches t-5 .. t-1 */}
                {[
                  { label: "t-5", x: 88, inRoll3: false },
                  { label: "t-4", x: 204, inRoll3: false },
                  { label: "t-3", x: 320, inRoll3: true },
                  { label: "t-2", x: 436, inRoll3: true },
                  { label: "t-1", x: 552, inRoll3: true },
                ].map((node) => (
                  <g key={node.label}>
                    <rect
                      x={node.x - 38}
                      y={78}
                      width={76}
                      height={52}
                      rx={10}
                      fill="#11142A"
                      stroke={node.inRoll3 ? "#74CBE9" : "#3B63E0"}
                      strokeWidth={1.5}
                    />
                    <text
                      x={node.x}
                      y={101}
                      textAnchor="middle"
                      fill="#EEEAF4"
                      fontSize="13"
                      fontWeight="600"
                      fontFamily="monospace"
                    >
                      {node.label}
                    </text>
                    <text
                      x={node.x}
                      y={119}
                      textAnchor="middle"
                      fill="#7E7A9E"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      observed
                    </text>
                  </g>
                ))}

                {/* Crimson shift(1) Temporal Barrier */}
                <line
                  x1={640}
                  y1={24}
                  x2={640}
                  y2={166}
                  stroke="#C9023E"
                  strokeWidth={3}
                />
                <rect
                  x={574}
                  y={144}
                  width={132}
                  height={24}
                  rx={12}
                  fill="#2B0613"
                  stroke="#C9023E"
                  strokeWidth={1.2}
                />
                <text
                  x={640}
                  y={160}
                  textAnchor="middle"
                  fill="#EEEAF4"
                  fontSize="11"
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  shift(1) barrier
                </text>

                {/* Match t prediction target */}
                <rect
                  x={692}
                  y={72}
                  width={144}
                  height={64}
                  rx={12}
                  fill="#2B0613"
                  stroke="#E5225A"
                  strokeWidth={1.8}
                />
                <text
                  x={764}
                  y={97}
                  textAnchor="middle"
                  fill="#EEEAF4"
                  fontSize="13"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  Fixture t
                </text>
                <text
                  x={764}
                  y={117}
                  textAnchor="middle"
                  fill="#A9A5C6"
                  fontSize="10.5"
                  fontFamily="monospace"
                >
                  predict target_base
                </text>

                {/* Reset note */}
                <text
                  x={48}
                  y={162}
                  fill="#7E7A9E"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  ppm_season resets per season; team_xg_share shifts by (season, team_id)
                </text>
              </svg>
            </div>

            {showFeatures && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {FEATURE_GROUPS.map((group) => (
                  <div
                    key={group.name}
                    className="rounded-xl border border-ink-700 bg-ink-950 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-mist-50">
                        {group.name}
                      </p>
                      <span className="font-mono text-[11px] text-spark-400">
                        {group.cols}
                      </span>
                    </div>
                    <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-mist-400">
                      {group.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>

        {/* Card 3: Decoupling the +2 DefCon Bonus */}
        <article className="stack-card relative z-30 md:min-h-[82dvh] md:pt-20 md:pb-8 flex items-center">
          <div className="w-full rounded-2xl border border-ink-700 bg-ink-900 p-6 sm:p-8 lg:p-10 shadow-[0_24px_70px_rgba(4,6,16,0.7)]">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-950 px-3 py-1 text-xs font-mono text-spark-400">
                  <ShieldCheck size={14} weight="duotone" aria-hidden="true" />
                  <span>DefCon-Free Regression Target</span>
                </div>

                <h3 className="mt-4 font-display text-3xl sm:text-4xl font-bold uppercase tracking-tight leading-[1.02] text-mist-50">
                  Decoupling the +2 DefCon Bonus
                </h3>

                <p className="mt-3 text-sm sm:text-base text-mist-300 leading-relaxed">
                  Defensive contribution bonuses were introduced in{" "}
                  <span className="text-mist-50 font-medium">2025-26</span>.
                  Subtracting{" "}
                  <code className="font-mono text-xs text-crimson-400">
                    defcon_points
                  </code>{" "}
                  from total points lets the regressor train cleanly across all
                  four seasons while an isotonic classifier calibrates{" "}
                  <code className="font-mono text-xs text-spark-400">
                    P(DefCon Hit)
                  </code>{" "}
                  without double-counting.
                </p>

                <div className="mt-5 rounded-xl border border-crimson-500/40 bg-ink-950 p-4 space-y-2 font-mono text-xs">
                  <p className="text-mist-50">
                    target_base = total_points - defcon_points
                  </p>
                  <p className="text-spark-400">
                    xP(p) = availability * (xP_base(p) + 2 * P(DefCon Hit_p))
                  </p>
                </div>
              </div>

              <div className="lg:col-span-7">
                <div className="rounded-xl border border-ink-700 bg-ink-950 p-5 space-y-4">
                  {/* Visual decomposition strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
                    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3.5">
                      <p className="font-mono text-[11px] text-mist-400">
                        Raw Label
                      </p>
                      <p className="mt-1 font-mono text-sm font-semibold text-mist-50">
                        total_points
                      </p>
                      <p className="mt-1 text-xs text-mist-300">
                        Full FPL match score
                      </p>
                    </div>

                    <div className="rounded-xl border border-crimson-500/45 bg-crimson-950/60 p-3.5">
                      <p className="font-mono text-[11px] text-crimson-400">
                        HGB Regressor
                      </p>
                      <p className="mt-1 font-mono text-sm font-semibold text-mist-50">
                        target_base
                      </p>
                      <p className="mt-1 text-xs text-mist-300">
                        Trained on 4 seasons
                      </p>
                    </div>

                    <div className="rounded-xl border border-spark-400/45 bg-spark-950/60 p-3.5">
                      <p className="font-mono text-[11px] text-spark-400">
                        Isotonic Classifier
                      </p>
                      <p className="mt-1 font-mono text-sm font-semibold text-mist-50">
                        +2 * P(DefCon Hit)
                      </p>
                      <p className="mt-1 text-xs text-mist-300">
                        Trained on 2025-26 outfield
                      </p>
                    </div>
                  </div>

                  {/* Positional CBIT / CBIRT rules */}
                  <div className="pt-4 border-t border-ink-700">
                    <p className="font-mono text-xs text-mist-400 mb-3">
                      Positional DefCon Thresholds (src/data_loader.py)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {DEFCON_THRESHOLDS.map((item) => (
                        <div
                          key={item.position}
                          className={`rounded-xl border bg-ink-900 p-3.5 ${item.borderClass}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display text-xl font-bold uppercase text-mist-50">
                              {item.position}
                            </span>
                            <span
                              className={`font-mono text-xs font-semibold ${item.accentClass}`}
                            >
                              {item.rule}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-mist-300 leading-relaxed">
                            {item.formula}
                          </p>
                          <p className="mt-2 font-mono text-[11px] text-mist-400">
                            {item.reward}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
