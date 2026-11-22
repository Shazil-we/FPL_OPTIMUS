"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, FlowArrow } from "@phosphor-icons/react";
import { Badge } from "../ui";

export interface AppHeaderProps {
  season: string;
  sourceMode: string;
}

/**
 * Single-line tactical workspace header with clickable overview link and telemetry badges.
 */
export default function AppHeader({ season, sourceMode }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-md text-mist-50 hover:text-mist-50/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 shrink-0"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-crimson-500 text-mist-50 font-display text-sm font-bold tracking-wider shadow-sm shadow-crimson-950/60"
            >
              FO
            </span>
            <span className="font-display text-2xl font-bold tracking-tight uppercase whitespace-nowrap">
              FPL-OPTIMUS
            </span>
          </Link>

          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-xs font-medium text-mist-300 hover:border-cobalt-400 hover:text-mist-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
          >
            <ArrowLeft size={13} weight="bold" aria-hidden="true" />
            <span>Back to Overview</span>
          </Link>

          <Link
            href="/workflow"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-xs font-medium text-mist-300 hover:border-cobalt-400 hover:text-mist-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
          >
            <FlowArrow size={13} weight="bold" aria-hidden="true" />
            <span>ML Workflow</span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 font-mono text-xs min-w-0">
          <Badge
            tone="neutral"
            className="px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-normal text-mist-300 bg-ink-900 border-ink-700"
          >
            <span className="hidden sm:inline">Season:</span>
            <strong className="text-spark-400 font-semibold">{season}</strong>
          </Badge>
          <Badge
            tone="neutral"
            className="px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-normal text-mist-300 bg-ink-900 border-ink-700 max-w-[140px] sm:max-w-[260px]"
          >
            <span className="hidden md:inline">Data Source:</span>
            <span className="hidden sm:inline md:hidden">Source:</span>
            <strong className="text-cobalt-400 font-semibold truncate">
              {sourceMode}
            </strong>
          </Badge>
        </div>
      </div>
    </header>
  );
}
