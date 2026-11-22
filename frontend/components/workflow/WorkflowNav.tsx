"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";

const SECTION_LINKS = [
  { href: "#pipeline", label: "Pipeline" },
  { href: "#prediction", label: "Prediction" },
  { href: "#archetypes", label: "Archetypes" },
  { href: "#optimizer", label: "Optimizer" },
  { href: "#backtest", label: "Backtest" },
] as const;

/**
 * Sticky single-line architecture navigation header for the /workflow route.
 */
export function WorkflowNav() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-ink-700 bg-ink-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-mist-50 hover:text-mist-50/90 transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 shrink-0"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-crimson-500 text-mist-50 font-display text-sm font-bold tracking-wider shadow-sm shadow-crimson-950/60"
          >
            FO
          </span>
          <span className="font-display text-2xl font-bold uppercase tracking-tight whitespace-nowrap">
            FPL-OPTIMUS
          </span>
        </Link>

        <nav
          aria-label="Workflow sections"
          className="hidden lg:flex items-center gap-6 text-sm text-mist-300"
        >
          {SECTION_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="hover:text-mist-50 transition-colors whitespace-nowrap rounded-md px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/"
            className="hidden sm:inline-flex items-center rounded-full border border-ink-700 bg-ink-900/80 hover:bg-ink-800 hover:border-mist-400/50 text-mist-300 hover:text-mist-50 px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
          >
            Overview
          </Link>

          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-full bg-crimson-500 hover:bg-crimson-400 text-mist-50 px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all active:scale-[0.98] shadow-sm shadow-crimson-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          >
            <span>Launch Optimizer</span>
            <ArrowRight size={13} weight="bold" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
