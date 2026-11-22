"use client";

import React, { useEffect, useState } from "react";
import rawWorkflowData from "../../data/workflowData.json";
import type { GmmPlayerPoint, WorkflowDataset } from "../../lib/workflowTypes";
import { WorkflowNav } from "./WorkflowNav";
import { WorkflowHero } from "./WorkflowHero";
import { PipelineDiagram } from "./PipelineDiagram";
import { TelemetryStickyStack } from "./TelemetryStickyStack";
import { PredictionLabSection } from "./PredictionLabSection";
import { ArchetypesBentoSection } from "./ArchetypesBentoSection";
import { AnnealingTheaterSection } from "./AnnealingTheaterSection";
import { BacktestClosingSection } from "./BacktestClosingSection";

const INITIAL_DATASET = rawWorkflowData as unknown as WorkflowDataset;
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const FETCH_TIMEOUT_MS = 4000;

const VALID_POSITIONS = new Set<GmmPlayerPoint["position"]>([
  "GK",
  "DEF",
  "MID",
  "FWD",
]);

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isValidPosition(value: unknown): value is GmmPlayerPoint["position"] {
  return (
    typeof value === "string" &&
    VALID_POSITIONS.has(value as GmmPlayerPoint["position"])
  );
}

/**
 * Filter and normalize `/api/benchmarks` `gmm_players` records into the frontend GMM scatter contract.
 */
function mapLiveGmmPlayers(rawPlayers: unknown[]): GmmPlayerPoint[] {
  const mapped: GmmPlayerPoint[] = [];

  for (const item of rawPlayers) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    if (row.status === "u" || Boolean(row.low_sample)) continue;

    const minutes = toFiniteNumber(row.minutes, 0);
    const archetype =
      typeof row.archetype === "string" ? row.archetype.trim() : "";
    if (minutes < 450 || !archetype || archetype === "Unclassified") continue;

    if (!isValidPosition(row.position)) continue;

    const element = toFiniteNumber(row.element, -1);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (element <= 0 || !name) continue;

    const rawTeamShort = row.team_short ?? row.teamShort;
    const teamShort =
      typeof rawTeamShort === "string" && rawTeamShort.trim().length > 0
        ? rawTeamShort.trim()
        : undefined;

    mapped.push({
      element,
      name,
      position: row.position,
      teamShort,
      cost: toFiniteNumber(row.price ?? row.cost, 0),
      minutes,
      archetype,
      confidence: toFiniteNumber(row.archetype_confidence ?? row.confidence, 0),
      pDefconAnchor: toFiniteNumber(
        row.p_defcon_anchor ?? row.pDefconAnchor,
        0
      ),
      pAttackingOutlet: toFiniteNumber(
        row.p_attacking_outlet ?? row.pAttackingOutlet,
        0
      ),
      xgPer90: toFiniteNumber(row.xg_per90 ?? row.xgPer90, 0),
      xaPer90: toFiniteNumber(row.xa_per90 ?? row.xaPer90, 0),
      cbitPer90: toFiniteNumber(row.cbit_per90 ?? row.cbitPer90, 0),
      cbirtPer90: toFiniteNumber(row.cbirt_per90 ?? row.cbirtPer90, 0),
      defconHitRate: toFiniteNumber(
        row.defcon_hit_rate ?? row.defconHitRate,
        0
      ),
      totalPoints: toFiniteNumber(row.total_points ?? row.totalPoints, 0),
    });
  }

  return mapped;
}

/**
 * Client shell for the /workflow architecture page with non-blocking live GMM hydration.
 */
export function WorkflowPageClient() {
  const [dataset, setDataset] = useState<WorkflowDataset>(INITIAL_DATASET);
  const [dataMode, setDataMode] = useState<"live" | "snapshot">("snapshot");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    async function hydrateLivePool() {
      try {
        const res = await fetch(`${API_BASE}/api/benchmarks`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;

        const payload: unknown = await res.json();
        if (
          !active ||
          !payload ||
          typeof payload !== "object" ||
          !("gmm_players" in payload)
        ) {
          return;
        }

        const rawList = (payload as { gmm_players?: unknown }).gmm_players;
        if (!Array.isArray(rawList) || rawList.length === 0) return;

        const livePlayers = mapLiveGmmPlayers(rawList);
        if (!active || livePlayers.length === 0) return;

        setDataset((prev) => ({
          ...prev,
          gmm: {
            ...prev.gmm,
            players: livePlayers,
          },
        }));
        setDataMode("live");
      } catch {
        // Keep verified snapshot mode silently when backend is unreachable or times out.
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void hydrateLivePool();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-ink-950 text-mist-50">
      <WorkflowNav />
      <WorkflowHero meta={dataset.meta} />
      <PipelineDiagram meta={dataset.meta} />
      <TelemetryStickyStack meta={dataset.meta} />
      <PredictionLabSection ml={dataset.ml} />
      <ArchetypesBentoSection gmm={dataset.gmm} dataMode={dataMode} />
      <AnnealingTheaterSection optimizer={dataset.optimizer} />
      <BacktestClosingSection backtest={dataset.backtest} />
    </main>
  );
}

export default WorkflowPageClient;
