"use client";

import React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowRight } from "@phosphor-icons/react";
import type { WorkflowDataset } from "../../lib/workflowTypes";

export interface WorkflowHeroProps {
  meta: WorkflowDataset["meta"];
}

const HERO_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Asymmetric split hero introducing the end-to-end FPL-Optimus pipeline architecture.
 */
export function WorkflowHero({ meta }: WorkflowHeroProps) {
  const reduce = useReducedMotion();

  return (
    <section
      aria-labelledby="workflow-hero-heading"
      data-test-season={meta.testSeason}
      className="min-h-[calc(100dvh-4rem)] pt-12 lg:pt-16 pb-12 px-4 sm:px-6 max-w-7xl mx-auto flex items-center"
    >
      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        <motion.div
          className="lg:col-span-6"
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.55, ease: HERO_EASE }
          }
        >
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crimson-400">
            FPL-OPTIMUS ARCHITECTURE
          </p>

          <h1
            id="workflow-hero-heading"
            className="mt-4 font-display text-5xl sm:text-6xl lg:text-[52px] xl:text-[64px] font-bold uppercase tracking-tight leading-[0.96] text-mist-50 text-balance"
          >
            From Match Telemetry to Optimal Squads
          </h1>

          <p className="mt-5 text-base text-mist-300 leading-relaxed max-w-[46ch] text-pretty">
            How gradient boosting, calibrated DefCon probabilities, Gaussian
            archetypes, and simulated annealing select Fantasy Premier League
            squads.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-full bg-crimson-500 hover:bg-crimson-400 text-mist-50 px-6 py-3 text-sm font-semibold whitespace-nowrap transition-all active:scale-[0.98] shadow-sm shadow-crimson-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
            >
              <span>Launch Optimizer</span>
              <ArrowRight size={15} weight="bold" aria-hidden="true" />
            </Link>

            <a
              href="#pipeline"
              className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 hover:bg-ink-800 hover:border-mist-400/50 text-mist-50 px-6 py-3 text-sm font-semibold whitespace-nowrap transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
            >
              <span>Inspect the Pipeline</span>
              <ArrowDown size={15} weight="bold" aria-hidden="true" />
            </a>
          </div>
        </motion.div>

        <motion.div
          className="lg:col-span-6"
          initial={reduce ? false : { opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 0.65, delay: 0.08, ease: HERO_EASE }
          }
        >
          <div className="rounded-2xl overflow-hidden border border-ink-700 bg-ink-900 shadow-[0_24px_80px_rgba(4,6,16,0.65)]">
            <div className="aspect-[16/10] w-full bg-ink-950">
              <img
                src="/media/workflow-hero.png"
                alt="Isometric dark obsidian pitch schematic with crimson tactical passing arcs and ice-blue contour waves"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
