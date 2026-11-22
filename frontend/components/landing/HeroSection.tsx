"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { ArrowRight, X } from "@phosphor-icons/react";
import { OptimusLoader } from "../ui";

const TOP_NAV_LINKS = [
  { href: "/app", label: "Squad Solver" },
  { href: "/app", label: "Transfer Studio" },
  { href: "/app", label: "Chip Horizon" },
] as const;

const SEED_BENCHMARKS = [
  { agent: "Simulated Annealing", mean: "68.71", std: "±0.40", best: "69.35", highlight: true },
  { agent: "Hill Climbing", mean: "65.88", std: "±1.20", best: "68.02", highlight: false },
  { agent: "Greedy Value", mean: "64.10", std: "0.00", best: "64.10", highlight: false },
  { agent: "Random Valid Squad", mean: "44.07", std: "±1.88", best: "49.35", highlight: false },
] as const;

const SEASON_BACKTEST = [
  { agent: "Simulated Annealing", pts: "2,231", avg: "58.7", highlight: true },
  { agent: "Hill Climbing", pts: "2,171", avg: "57.1", highlight: false },
  { agent: "Random Baseline", pts: "2,135", avg: "56.2", highlight: false },
  { agent: "Greedy Baseline", pts: "2,084", avg: "54.8", highlight: false },
] as const;

/**
 * Full-bleed viewport hero framing the video canvas with perimeter editorial typography and benchmark drawer.
 */
export function HeroSection() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [benchmarksOpen, setBenchmarksOpen] = useState(false);
  const [navigatingToApp, setNavigatingToApp] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const isReduced = motionQuery.matches;
    setReduceMotion(isReduced);

    const handleMotionChange = (e: MediaQueryListEvent) => {
      setReduceMotion(e.matches);
    };
    motionQuery.addEventListener("change", handleMotionChange);

    if (isReduced) {
      return () => {
        motionQuery.removeEventListener("change", handleMotionChange);
      };
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from(".hero-stagger", {
        y: 18,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: "power3.out",
        clearProps: "transform,opacity",
      });
    }, rootRef);

    return () => {
      motionQuery.removeEventListener("change", handleMotionChange);
      ctx.revert();
    };
  }, []);

  useEffect(() => {
    if (!benchmarksOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setBenchmarksOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [benchmarksOpen]);

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden">
      {/* Static full-bleed video backdrop */}
      <div className="absolute inset-0" aria-hidden="true">
        {reduceMotion ? (
          <img
            src="/media/hero-poster.jpg"
            alt=""
            className="h-full w-full object-cover object-[64%_center] brightness-[1.03] contrast-[1.05] saturate-[1.12]"
          />
        ) : (
          <video
            className="h-full w-full object-cover object-[64%_center] brightness-[1.03] contrast-[1.05] saturate-[1.12]"
            poster="/media/hero-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
          >
            <source src="/media/hero.webm" type="video/webm" />
            <source src="/media/hero.mp4" type="video/mp4" />
          </video>
        )}
      </div>

      {/* Localized painterly crimson wash behind left column only */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 48% 68% at 19% 49%, rgba(110, 11, 41, 0.68) 0%, rgba(80, 12, 35, 0.34) 54%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(30, 16, 34, 0.52) 0%, transparent 22%)",
        }}
      />

      {/* Perimeter 4-zone UI framing the center-right robot */}
      <div className="relative z-10 flex h-full w-full flex-col justify-between">
        {/* Top Bar */}
        <header className="px-6 sm:px-12 lg:px-16 pt-5 sm:pt-8 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 text-[#FAF2F5] drop-shadow-[0_2px_12px_rgba(30,16,34,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FAF2F5]/75 rounded-md"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="shrink-0 text-[#FAF2F5]"
            >
              <g fill="currentColor">
                <rect x="10.8" y="2" width="2.4" height="7.5" rx="1.2" />
                <rect
                  x="10.8"
                  y="2"
                  width="2.4"
                  height="7.5"
                  rx="1.2"
                  transform="rotate(60 12 12)"
                />
                <rect
                  x="10.8"
                  y="2"
                  width="2.4"
                  height="7.5"
                  rx="1.2"
                  transform="rotate(120 12 12)"
                />
                <rect
                  x="10.8"
                  y="2"
                  width="2.4"
                  height="7.5"
                  rx="1.2"
                  transform="rotate(180 12 12)"
                />
                <rect
                  x="10.8"
                  y="2"
                  width="2.4"
                  height="7.5"
                  rx="1.2"
                  transform="rotate(240 12 12)"
                />
                <rect
                  x="10.8"
                  y="2"
                  width="2.4"
                  height="7.5"
                  rx="1.2"
                  transform="rotate(300 12 12)"
                />
              </g>
            </svg>
            <span className="font-editorial text-2xl sm:text-[26px] font-semibold tracking-[-0.01em] text-[#FAF2F5] whitespace-nowrap">
              FPL Optimus
            </span>
          </Link>
        </header>

        {/* Center-Left Editorial Stack */}
        <div className="px-6 sm:px-12 lg:px-16 max-w-[760px]">
          <p className="hero-stagger font-code text-xs sm:text-[13px] tracking-[0.03em] text-[#FAF2F5]/90 mb-2.5 sm:mb-3">
            Forge Your Gameweek Legacy.
          </p>

          <h1 className="hero-stagger font-editorial text-4xl sm:text-6xl lg:text-[66px] font-normal leading-[1.02] tracking-[-0.02em] text-[#FAF2F5] drop-shadow-[0_4px_24px_rgba(30,16,34,0.45)] pb-1">
            Command the Pitch
            <br />
            Every Gameweek
          </h1>

          <p className="hero-stagger font-ui text-xs sm:text-[14.5px] leading-[1.6] text-[#FAF2F5]/85 max-w-[44ch] mt-3 sm:mt-4">
            From decoupled expected points to 5,000-iteration simulated annealing, deploy the mathematical edge built for Fantasy Premier League.
          </p>

          <div className="hero-stagger mt-5 sm:mt-7 flex flex-wrap items-center gap-3.5">
            <Link
              href="/app"
              onClick={() => setNavigatingToApp(true)}
              className="rounded-full bg-[#FAF2F5] text-[#220E1B] hover:bg-white px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-ui font-semibold inline-flex items-center gap-2.5 shadow-[0_12px_32px_rgba(30,16,34,0.38)] transition-transform active:scale-[0.98] whitespace-nowrap"
            >
              <span>Launch Optimizer</span>
              <ArrowRight size={15} weight="bold" aria-hidden="true" />
            </Link>

            <Link
              href="/workflow"
              className="rounded-full border border-[#FAF2F5]/45 bg-[#220E1B]/20 hover:bg-[#FAF2F5]/12 hover:border-[#FAF2F5]/80 backdrop-blur-sm text-[#FAF2F5] px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-ui font-medium inline-flex items-center gap-2.5 transition active:scale-[0.98] whitespace-nowrap"
            >
              <span>Explore ML Pipeline</span>
              <ArrowRight size={15} weight="regular" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Bottom Bar */}
        <footer className="px-6 sm:px-12 lg:px-16 pb-5 sm:pb-8 flex items-end justify-between gap-4">
          <nav
            aria-label="Optimizer Sections"
            className="flex flex-wrap items-center gap-2.5"
          >
            {TOP_NAV_LINKS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setNavigatingToApp(true)}
                className="rounded-full border border-[#FAF2F5]/25 bg-[#1E1022]/45 hover:bg-[#FAF2F5]/15 hover:border-[#FAF2F5]/55 backdrop-blur-md px-4 py-1.5 text-xs font-ui font-medium text-[#FAF2F5]/90 hover:text-white transition whitespace-nowrap cursor-pointer"
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setBenchmarksOpen(true)}
              className="rounded-full border border-[#FAF2F5]/25 bg-[#1E1022]/45 hover:bg-[#FAF2F5]/15 hover:border-[#FAF2F5]/55 backdrop-blur-md px-4 py-1.5 text-xs font-ui font-medium text-[#FAF2F5]/90 hover:text-white transition whitespace-nowrap cursor-pointer"
            >
              Benchmarks
            </button>
          </nav>
        </footer>
      </div>

      {/* Compact In-Frame Glass Benchmarks & Architecture Modal */}
      {benchmarksOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="benchmarks-modal-title"
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#1E1022]/70 backdrop-blur-md p-4 sm:p-6"
          onClick={() => setBenchmarksOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[86dvh] overflow-y-auto rounded-2xl border border-[#FAF2F5]/20 bg-[#1E1022]/90 backdrop-blur-xl p-6 sm:p-8 text-[#FAF2F5] shadow-[0_24px_80px_rgba(12,6,18,0.65)]"
          >
            <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#FAF2F5]/15">
              <div>
                <p className="font-code text-[11px] text-[#D6A4B8]">
                  src/experiments.py --seed 2026
                </p>
                <h2
                  id="benchmarks-modal-title"
                  className="font-editorial text-2xl sm:text-3xl font-semibold tracking-[-0.01em] text-[#FAF2F5] mt-1"
                >
                  Architecture &amp; Empirical Benchmarks
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setBenchmarksOpen(false)}
                aria-label="Close benchmarks modal"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#FAF2F5]/25 bg-[#FAF2F5]/10 text-[#FAF2F5] hover:bg-[#FAF2F5]/20 transition cursor-pointer"
              >
                <X size={16} weight="bold" aria-hidden="true" />
              </button>
            </div>

            {/* 3-Stage Architecture Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-5 border-b border-[#FAF2F5]/15">
              <div className="rounded-xl border border-[#FAF2F5]/15 bg-[#FAF2F5]/[0.04] p-3.5">
                <p className="font-code text-[11px] text-[#A6C0E2]">
                  Decoupled xP Engine
                </p>
                <p className="font-ui text-xs text-[#FAF2F5]/85 mt-1.5 leading-relaxed">
                  HistGradientBoostingRegressor base xP plus calibrated DefCon CBIT/CBIRT classifier (0.874 ROC-AUC, 0.0440 Brier, 1.850 RMSE).
                </p>
              </div>
              <div className="rounded-xl border border-[#FAF2F5]/15 bg-[#FAF2F5]/[0.04] p-3.5">
                <p className="font-code text-[11px] text-[#D6A4B8]">
                  Simulated Annealing
                </p>
                <p className="font-ui text-xs text-[#FAF2F5]/85 mt-1.5 leading-relaxed">
                  5,000 geometric-cooling iterations per solve (80% single-swap, 20% cross-position double-swap) enforcing exact FPL budget and club caps.
                </p>
              </div>
              <div className="rounded-xl border border-[#FAF2F5]/15 bg-[#FAF2F5]/[0.04] p-3.5">
                <p className="font-code text-[11px] text-[#FAF2F5]">
                  Transfer &amp; Chip Studio
                </p>
                <p className="font-ui text-xs text-[#FAF2F5]/85 mt-1.5 leading-relaxed">
                  1-5 banked free transfers, -4 pt hit trade-off check, 1-GW Freehit and 5-GW Wildcard solvers, plus BIC-selected GMM player archetypes.
                </p>
              </div>
            </div>

            {/* Empirical Data Grids */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 py-5">
              <div className="rounded-xl border border-[#FAF2F5]/15 bg-[#FAF2F5]/[0.03] p-4">
                <p className="font-code text-[11px] text-[#D6A4B8] mb-3">
                  30-Seed Optimization (5,000 Evaluations)
                </p>
                <div className="divide-y divide-[#FAF2F5]/10">
                  {SEED_BENCHMARKS.map((row) => (
                    <div
                      key={row.agent}
                      className="py-2 flex items-center justify-between gap-2 text-xs font-ui"
                    >
                      <span
                        className={
                          row.highlight
                            ? "font-semibold text-[#FAF2F5]"
                            : "text-[#FAF2F5]/75"
                        }
                      >
                        {row.agent}
                      </span>
                      <span className="font-code tabular-nums text-[#FAF2F5]">
                        {row.mean} ({row.std}) · best {row.best}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#FAF2F5]/15 bg-[#FAF2F5]/[0.03] p-4">
                <p className="font-code text-[11px] text-[#A6C0E2] mb-3">
                  38-GW Season Backtest &amp; Holdout
                </p>
                <div className="divide-y divide-[#FAF2F5]/10">
                  {SEASON_BACKTEST.map((row) => (
                    <div
                      key={row.agent}
                      className="py-2 flex items-center justify-between gap-2 text-xs font-ui"
                    >
                      <span
                        className={
                          row.highlight
                            ? "font-semibold text-[#FAF2F5]"
                            : "text-[#FAF2F5]/75"
                        }
                      >
                        {row.agent}
                      </span>
                      <span className="font-code tabular-nums text-[#FAF2F5]">
                        {row.pts} pts ({row.avg}/GW)
                      </span>
                    </div>
                  ))}
                </div>
                <p className="font-code text-[11px] text-[#FAF2F5]/75 mt-3 pt-2.5 border-t border-[#FAF2F5]/10 tabular-nums">
                  ML Holdout: 1.850 RMSE · 0.934 MAE · 0.305 R²
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-[#FAF2F5]/15 flex flex-wrap items-center justify-between gap-3">
              <p className="font-ui text-xs text-[#FAF2F5]/70">
                Powered by Official FPL API &amp; Vaastav FPL Historical Dataset
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  href="/workflow"
                  onClick={() => setBenchmarksOpen(false)}
                  className="rounded-full border border-[#FAF2F5]/30 bg-[#FAF2F5]/[0.06] hover:bg-[#FAF2F5]/15 hover:border-[#FAF2F5]/65 text-[#FAF2F5] px-4 py-2 text-xs font-ui font-medium inline-flex items-center gap-1.5 transition active:scale-[0.98] whitespace-nowrap"
                >
                  <span>Explore ML Pipeline</span>
                  <ArrowRight size={13} weight="regular" aria-hidden="true" />
                </Link>
                <Link
                  href="/app"
                  onClick={() => setNavigatingToApp(true)}
                  className="rounded-full bg-[#FAF2F5] text-[#220E1B] hover:bg-white px-5 py-2 text-xs font-ui font-semibold inline-flex items-center gap-2 transition active:scale-[0.98] whitespace-nowrap"
                >
                  <span>Launch Optimizer</span>
                  <ArrowRight size={14} weight="bold" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {navigatingToApp && (
        <OptimusLoader
          mode="fullscreen"
          label="Launching Tactical Optimizer"
          sublabel="Loading live FPL telemetry & 5,000-iteration solver"
        />
      )}
    </div>
  );
}
