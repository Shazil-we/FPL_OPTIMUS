"use client";

import React from "react";
import { ArrowsLeftRight, Star } from "@phosphor-icons/react";

export interface PlayerCardData {
  element: number;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  team_id: number;
  team_short?: string;
  price: number;
  xp_base: number;
  p_defcon: number;
  xp: number;
  role?: string;
  is_captain?: boolean;
  is_vice_captain?: boolean;
  is_suggested_captain?: boolean;
  multiplier?: number;
  fdr?: number;
  was_home?: number;
  opponent_short?: string;
  status?: string;
  news?: string;
  archetype?: string;
  p_defcon_anchor?: number;
  p_attacking_outlet?: number;
  live_points?: number;
  live_defcon?: number;
  live_defcon_hit?: boolean;
}

const FDR_COLORS: Record<number, string> = {
  1: "bg-cobalt-950 text-spark-400 border border-spark-400/40",
  2: "bg-cobalt-500 text-mist-50",
  3: "bg-ink-800 text-mist-300 border border-ink-700",
  4: "bg-gold-950 text-gold-400 border border-gold-400/50",
  5: "bg-crimson-500 text-mist-50",
};

const POS_RING: Record<string, string> = {
  GK: "border-gold-400/60",
  DEF: "border-cobalt-400/60",
  MID: "border-spark-400/60",
  FWD: "border-crimson-400/60",
};

export default function PlayerCard({
  player,
  onSelect,
  interactiveMode = "view",
  isSelected = false,
  isValidSwapTarget = false,
  isDimmed = false,
  isTransferredIn = false,
}: {
  player: PlayerCardData;
  onSelect?: (p: PlayerCardData) => void;
  interactiveMode?: "view" | "pick_team" | "transfers";
  isSelected?: boolean;
  isValidSwapTarget?: boolean;
  isDimmed?: boolean;
  isTransferredIn?: boolean;
}) {
  const fdr = player.fdr ?? 3;
  const fdrClass = FDR_COLORS[fdr] || FDR_COLORS[3];
  const venue = player.was_home === 0 ? "A" : "H";
  const defconPct = Math.round((player.p_defcon ?? 0) * 100);

  const capMult = player.is_captain
    ? player.multiplier && player.multiplier >= 3
      ? 3
      : 2
    : 1;
  const displayedXp = player.xp * capMult;
  const displayedLivePoints =
    typeof player.live_points === "number"
      ? player.live_points * capMult
      : undefined;

  let ringClass = player.is_suggested_captain
    ? "border-gold-400 ring-1 ring-gold-400/50"
    : POS_RING[player.position] || "border-ink-700";

  let bgClass = "bg-ink-900/95";

  if (isSelected) {
    if (interactiveMode === "transfers") {
      ringClass = "border-danger-400 ring-2 ring-danger-400 scale-[1.03]";
      bgClass = "bg-danger-950/50";
    } else {
      ringClass = "border-cobalt-400 ring-2 ring-cobalt-400 scale-[1.03]";
      bgClass = "bg-cobalt-950/50";
    }
  } else if (isValidSwapTarget) {
    ringClass =
      "border-spark-400 ring-2 ring-spark-400/80 border-dashed hover:bg-spark-950/40";
  }

  const interactionClass = isDimmed
    ? "opacity-40 cursor-not-allowed"
    : isSelected
    ? "cursor-pointer"
    : isValidSwapTarget
    ? "cursor-pointer active:scale-[0.98]"
    : "cursor-pointer hover:border-spark-400/80 hover:bg-ink-800/80 active:scale-[0.98]";

  return (
    <div
      onClick={() => onSelect?.(player)}
      title={
        player.news
          ? `${player.name}: ${player.news}`
          : `${player.name} (${player.archetype || player.position})`
      }
      className={`relative flex flex-col items-center justify-between flex-1 min-w-0 max-w-[122px] rounded-lg ${bgClass} border ${ringClass} ${interactionClass} p-1.5 sm:p-2 shadow-md transition`}
    >
      {/* Captain / Triple Captain / Vice Badge */}
      {player.is_captain && (
        <span
          className={`absolute -top-2 -left-2 z-20 ${
            capMult === 3
              ? "bg-gold-400 text-ink-950"
              : "bg-crimson-500 text-mist-50"
          } text-[10px] font-extrabold px-1.5 py-0.5 rounded-md shadow`}
        >
          {capMult === 3 ? "TC (3×)" : "C (2×)"}
        </span>
      )}
      {player.is_vice_captain && (
        <span className="absolute -top-2 -left-2 z-20 bg-cobalt-500 text-mist-50 text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow">
          V
        </span>
      )}

      {/* AI Suggested Captain / New Transfer / Interactive Swap Badges */}
      {isTransferredIn ? (
        <span
          title="Transferred In (Draft)"
          className="absolute -top-2 -right-2 z-20 bg-spark-400 text-ink-950 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shadow"
        >
          NEW
        </span>
      ) : (
        player.is_suggested_captain && (
          <span
            title="AI Suggested Captain (Highest Projected xP)"
            className="absolute -top-2 -right-2 z-20 inline-flex items-center gap-0.5 bg-gold-400 text-ink-950 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shadow"
          >
            <Star weight="fill" className="w-2.5 h-2.5 shrink-0" />
            <span>AI CAP</span>
          </span>
        )
      )}

      {isValidSwapTarget && (
        <span className="absolute -bottom-2 z-20 inline-flex items-center gap-0.5 bg-spark-400 text-ink-950 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shadow">
          <ArrowsLeftRight weight="bold" className="w-2.5 h-2.5 shrink-0" />
          <span>SUB</span>
        </span>
      )}

      {interactiveMode === "transfers" && isSelected && (
        <span className="absolute -bottom-2 z-20 bg-danger-400 text-ink-950 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shadow">
          OUT
        </span>
      )}

      {/* FDR + Opponent Badge */}
      <div className="flex items-center justify-between w-full text-[9px] sm:text-[10px] mb-1 gap-0.5">
        <span className="text-mist-300 font-mono truncate">
          {player.team_short || `T${player.team_id}`}
        </span>
        <span className={`px-1 py-px rounded-md font-semibold shrink-0 ${fdrClass}`}>
          {player.opponent_short || "FIX"} ({venue})
        </span>
      </div>

      {/* Name + Price */}
      <div className="text-[11px] sm:text-xs font-bold text-center truncate w-full text-mist-50">
        {player.name}
      </div>
      <div className="text-[9px] sm:text-[10px] text-mist-300 truncate w-full text-center">
        £{player.price.toFixed(1)}m · {player.position}
      </div>

      {/* Metrics Footer: xP + DefCon + Live Points (Doubled/Tripled for Captain) */}
      <div className="mt-1.5 w-full border-t border-ink-700 pt-1 flex flex-col gap-0.5 text-[10px] font-mono">
        <div className="flex justify-between items-center">
          <span className="text-mist-300">
            xP{capMult > 1 ? ` (${capMult}×)` : ""}:
          </span>
          <span className="text-spark-400 font-bold">
            {displayedXp.toFixed(2)}
          </span>
        </div>
        {player.position !== "GK" && (
          <div className="flex justify-between items-center">
            <span className="text-mist-300">DefCon:</span>
            <span className="text-cobalt-400">{defconPct}%</span>
          </div>
        )}
        {typeof displayedLivePoints === "number" && (
          <div className="flex justify-between items-center bg-ink-800 text-gold-400 px-1.5 py-0.5 rounded-md mt-0.5">
            <span>Live:</span>
            <span className="text-mist-50 font-bold">
              {displayedLivePoints} pts
              {capMult > 1 ? ` (${capMult}×)` : ""}
              {player.live_defcon_hit ? " +DC" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
