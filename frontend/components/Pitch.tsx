"use client";

import React from "react";
import {
  ArrowClockwise,
  ArrowRight,
  Check,
  Crown,
  WarningCircle,
} from "@phosphor-icons/react";
import PlayerCard, { PlayerCardData } from "./PlayerCard";

export interface SuggestedCaptainInfo {
  element: number;
  name: string;
  position: string;
  team_short?: string;
  xp: number;
  current_captain_name?: string;
  current_captain_xp?: number;
  delta_xp?: number;
}

export interface SquadData {
  formation: string;
  fitness: number;
  projected_points?: number;
  avg_gw_points?: number;
  n_gws?: number;
  horizon_gws?: number[];
  gw_rating_pct?: number;
  cost: number;
  bank: number;
  active_chip?: string | null;
  suggested_captain?: SuggestedCaptainInfo;
  starters: PlayerCardData[];
  bench: PlayerCardData[];
}

const CHIP_LABELS: Record<string, string> = {
  wildcard: "Wildcard Active",
  freehit: "Free Hit Active",
  bboost: "Bench Boost Active (All 15 Players Score)",
  "3xc": "Triple Captain Active (Captain 3× Points)",
};

export default function Pitch({
  squad,
  viewLabel,
  liveMap,
  isFutureGw,
  selectedGw,
  picksSourceGw,
  suggestedCaptainCompare,
  interactiveMode = "view",
  selectedElement = null,
  validSwapElements,
  transferredInElements,
  violations = [],
  hitCost = 0,
  evalLoading = false,
  onSelectPlayer,
  onSetCaptain,
  onSetViceCaptain,
  onAutoPickXI,
  onRefreshEvaluation,
  onSavePickTeam,
  onResetDraft,
  draftModified = false,
}: {
  squad: SquadData | null;
  viewLabel?: string;
  liveMap?: Record<
    number,
    { total_points: number; defcon_count: number; defcon_hit: boolean }
  >;
  isFutureGw?: boolean;
  selectedGw?: number;
  picksSourceGw?: number | null;
  suggestedCaptainCompare?: SuggestedCaptainInfo | null;
  interactiveMode?: "view" | "pick_team" | "transfers";
  selectedElement?: number | null;
  validSwapElements?: Set<number>;
  transferredInElements?: Set<number>;
  violations?: string[];
  hitCost?: number;
  evalLoading?: boolean;
  onSelectPlayer?: (p: PlayerCardData) => void;
  onSetCaptain?: (el: number) => void;
  onSetViceCaptain?: (el: number) => void;
  onAutoPickXI?: () => void;
  onRefreshEvaluation?: () => void;
  onSavePickTeam?: () => void;
  onResetDraft?: () => void;
  draftModified?: boolean;
}) {
  if (!squad) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center text-mist-300">
        No squad loaded yet. Wait for Optimus Freehit/Wildcard build or enter a{" "}
        <strong className="text-mist-50">Manager Team ID</strong> above.
      </div>
    );
  }

  const attachLive = (p: PlayerCardData): PlayerCardData => {
    if (isFutureGw || interactiveMode !== "view") {
      return { ...p, live_points: undefined };
    }
    const lv = liveMap?.[p.element];
    if (!lv) return p;
    return {
      ...p,
      live_points: lv.total_points,
      live_defcon: lv.defcon_count,
      live_defcon_hit: lv.defcon_hit,
    };
  };

  const starters = squad.starters.map(attachLive);
  const bench = squad.bench.map(attachLive);
  const isBenchBoost = squad.active_chip === "bboost";
  const isMultiGw = (squad.n_gws ?? 1) > 1;

  // Calculate total live points across starters (with 2x/3x captain multiplier) + bench if Bench Boost
  const hasLive =
    !isFutureGw &&
    interactiveMode === "view" &&
    liveMap &&
    Object.keys(liveMap).length > 0;
  const totalLivePoints = hasLive
    ? starters.reduce((acc, p) => {
        const mult = p.is_captain
          ? p.multiplier && p.multiplier >= 3
            ? 3
            : 2
          : 1;
        return acc + (p.live_points ?? 0) * mult;
      }, 0) +
      (isBenchBoost
        ? bench.reduce((acc, p) => acc + (p.live_points ?? 0), 0)
        : 0)
    : null;

  // Projected points total (starters with captain 2x/3x + bench if Bench Boost)
  const projectedTotal =
    squad.projected_points ??
    starters.reduce((acc, p) => {
      const mult = p.is_captain
        ? p.multiplier && p.multiplier >= 3
          ? 3
          : 2
        : 1;
      return acc + p.xp * mult;
    }, 0) + (isBenchBoost ? bench.reduce((acc, p) => acc + p.xp, 0) : 0);

  const gwRating =
    squad.gw_rating_pct ??
    Math.min(100, Math.round((squad.fitness / 68.5) * 100));
  const ratingColor =
    gwRating >= 90
      ? "text-spark-400 bg-spark-950 border-spark-400/50"
      : gwRating >= 75
      ? "text-cobalt-400 bg-cobalt-950 border-cobalt-400/50"
      : "text-gold-400 bg-gold-950 border-gold-400/50";

  const capInfo = suggestedCaptainCompare || squad.suggested_captain;

  const gks = starters.filter((p) => p.position === "GK");
  const defs = starters.filter((p) => p.position === "DEF");
  const mids = starters.filter((p) => p.position === "MID");
  const fwds = starters.filter((p) => p.position === "FWD");

  const selectedCard =
    selectedElement !== null
      ? [...starters, ...bench].find((p) => p.element === selectedElement) ||
        null
      : null;
  const selectedIsStarter = selectedCard
    ? starters.some((p) => p.element === selectedCard.element)
    : false;

  const renderCard = (p: PlayerCardData) => {
    const isSelected = selectedElement === p.element;
    const isValidTarget = Boolean(
      interactiveMode === "pick_team" &&
        selectedElement !== null &&
        !isSelected &&
        validSwapElements?.has(p.element)
    );
    const isDimmed = Boolean(
      interactiveMode === "pick_team" &&
        selectedElement !== null &&
        !isSelected &&
        !isValidTarget
    );
    const isTransferredIn = Boolean(transferredInElements?.has(p.element));

    return (
      <PlayerCard
        key={p.element}
        player={p}
        onSelect={onSelectPlayer}
        interactiveMode={interactiveMode}
        isSelected={isSelected}
        isValidSwapTarget={isValidTarget}
        isDimmed={isDimmed}
        isTransferredIn={isTransferredIn}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Future Projection / Mode Label / Active Chip Callout Bar */}
      {(isFutureGw || squad.active_chip || viewLabel) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cobalt-950/60 border border-cobalt-500/40 px-3.5 py-2 text-xs">
          {viewLabel ? (
            <span className="text-mist-300 font-medium">{viewLabel}</span>
          ) : (
            isFutureGw && (
              <span className="text-mist-300 font-medium">
                <strong className="text-mist-50">
                  Projected Squad for GW{selectedGw}
                </strong>{" "}
                (using
                {draftModified
                  ? " your planned draft picks"
                  : ` picks from GW${
                      picksSourceGw || (selectedGw ? selectedGw - 1 : "")
                    }`}{" "}
                + GW{selectedGw} fixture xP)
              </span>
            )
          )}
          {squad.active_chip && (
            <span className="bg-gold-400 text-ink-950 font-extrabold px-2.5 py-0.5 rounded-md text-[11px] uppercase tracking-wide">
              {CHIP_LABELS[squad.active_chip] || squad.active_chip}
            </span>
          )}
        </div>
      )}

      {/* FPL Rule Violation Warning Banner (exploratory preview in Transfers) */}
      {violations.length > 0 && (
        <div className="rounded-xl bg-danger-950/70 border border-danger-400/60 px-3.5 py-2.5 text-xs text-mist-50 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 font-bold text-danger-400">
            <WarningCircle weight="fill" className="w-4 h-4 shrink-0" />
            <span>
              Preview Only: FPL Rule Warning (projected points shown below;
              resolve before confirming transfers)
            </span>
          </div>
          <ul className="list-disc list-inside font-mono text-[11px] text-mist-50/90 space-y-0.5">
            {violations.map((v, idx) => (
              <li key={idx}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Pick Team Interactive Control Strip */}
      {interactiveMode === "pick_team" && (
        <div className="rounded-xl bg-cobalt-950/50 border border-cobalt-500/45 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {selectedCard ? (
              <>
                <span className="text-mist-300 font-semibold">
                  Selected:{" "}
                  <strong className="text-mist-50">
                    {selectedCard.name} ({selectedCard.position})
                  </strong>
                </span>
                {selectedIsStarter && !selectedCard.is_captain && onSetCaptain && (
                  <button
                    type="button"
                    onClick={() => onSetCaptain(selectedCard.element)}
                    className="rounded-md bg-crimson-500 hover:bg-crimson-400 text-mist-50 font-bold px-2.5 py-1 text-[11px] transition active:scale-[0.98] cursor-pointer"
                  >
                    Make Captain (2×)
                  </button>
                )}
                {selectedIsStarter &&
                  !selectedCard.is_vice_captain &&
                  onSetViceCaptain && (
                    <button
                      type="button"
                      onClick={() => onSetViceCaptain(selectedCard.element)}
                      className="rounded-md bg-cobalt-500 hover:bg-cobalt-400 text-mist-50 font-bold px-2.5 py-1 text-[11px] transition active:scale-[0.98] cursor-pointer"
                    >
                      Make Vice-Captain (V)
                    </button>
                  )}
                <span className="text-[11px] text-spark-400 font-mono">
                  Click any highlighted card to substitute
                </span>
              </>
            ) : (
              <span className="text-mist-300">
                Click any player on the pitch or bench to{" "}
                <strong className="text-mist-50">Substitute</strong>, reorder
                bench, or change{" "}
                <strong className="text-mist-50">Captain / Vice-Captain</strong>.
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {onAutoPickXI && (
              <button
                type="button"
                onClick={onAutoPickXI}
                className="rounded-md bg-ink-800 hover:bg-ink-700 border border-ink-700 text-spark-400 font-semibold px-2.5 py-1 text-[11px] transition active:scale-[0.98] cursor-pointer"
              >
                Auto-Pick Best XI
              </button>
            )}
            {onRefreshEvaluation && (
              <button
                type="button"
                disabled={evalLoading}
                onClick={onRefreshEvaluation}
                className="rounded-md bg-ink-800 hover:bg-ink-700 border border-cobalt-500/50 text-cobalt-400 font-semibold px-2.5 py-1 text-[11px] disabled:opacity-50 inline-flex items-center gap-1 transition active:scale-[0.98] cursor-pointer"
              >
                <ArrowClockwise
                  weight="bold"
                  className={`w-3.5 h-3.5 shrink-0 ${
                    evalLoading ? "animate-spin" : ""
                  }`}
                />
                <span>
                  {evalLoading ? "Refreshing..." : "Refresh Pts & Rating"}
                </span>
              </button>
            )}
            {onSavePickTeam && (
              <button
                type="button"
                onClick={onSavePickTeam}
                className="rounded-md bg-crimson-500 hover:bg-crimson-400 text-mist-50 font-bold px-2.5 py-1 text-[11px] inline-flex items-center gap-1 transition active:scale-[0.98] cursor-pointer"
              >
                <Check weight="bold" className="w-3.5 h-3.5 shrink-0" />
                <span>Save Picks</span>
              </button>
            )}
            {draftModified && onResetDraft && (
              <button
                type="button"
                onClick={onResetDraft}
                className="rounded-md bg-danger-950 hover:bg-danger-400/20 border border-danger-400/50 text-danger-400 font-semibold px-2.5 py-1 text-[11px] transition active:scale-[0.98] cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* Transfers Mode Instruction Strip */}
      {interactiveMode === "transfers" && (
        <div className="rounded-xl bg-danger-950/45 border border-danger-400/50 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
          <span className="text-mist-300">
            {selectedCard ? (
              <>
                Transferring Out:{" "}
                <strong className="text-mist-50">
                  {selectedCard.name} ({selectedCard.position} · £
                  {selectedCard.price.toFixed(1)}m)
                </strong>
                : pick any replacement in the{" "}
                <strong className="inline-flex items-center gap-1 text-mist-50">
                  <span>Player Market</span>
                  <ArrowRight weight="bold" className="w-3 h-3 shrink-0" />
                </strong>
              </>
            ) : (
              <>
                Click any player on the pitch or bench to mark them{" "}
                <strong className="text-mist-50">Transfer Out</strong>, then
                choose a replacement on the right.
              </>
            )}
          </span>
          {onRefreshEvaluation && (
            <button
              type="button"
              disabled={evalLoading}
              onClick={onRefreshEvaluation}
              className="rounded-md bg-cobalt-500 hover:bg-cobalt-400 text-mist-50 font-bold px-2.5 py-1 text-[11px] disabled:opacity-50 inline-flex items-center gap-1 transition active:scale-[0.98] cursor-pointer"
            >
              <ArrowClockwise
                weight="bold"
                className={`w-3.5 h-3.5 shrink-0 ${
                  evalLoading ? "animate-spin" : ""
                }`}
              />
              <span>
                {evalLoading
                  ? "Refreshing..."
                  : "Refresh Projected Pts & GW Rating"}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Summary Header Bar with GW Rating % & Total Live/Projected Points */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-mist-300">
            {isMultiGw ? "5-GW Rating:" : "GW Rating:"}
          </span>
          <span
            className={`font-extrabold px-2 py-0.5 rounded-md border ${ratingColor}`}
          >
            {gwRating}%
          </span>
        </div>
        <div className="text-mist-300">
          {isMultiGw ? "5-GW Projected xP:" : "Projected GW xP:"}{" "}
          <span className="text-spark-400 font-bold">
            {projectedTotal.toFixed(1)} pts
          </span>
          {isMultiGw && squad.avg_gw_points !== undefined && (
            <span className="text-mist-300 ml-1">
              (avg {squad.avg_gw_points.toFixed(1)}/GW)
            </span>
          )}
          {hitCost > 0 && (
            <span className="text-danger-400 ml-1">
              (Net: {(projectedTotal - hitCost).toFixed(1)}, -{hitCost} hit)
            </span>
          )}
        </div>
        {totalLivePoints !== null && (
          <div className="text-mist-300">
            Live GW Points:{" "}
            <span className="text-gold-400 font-extrabold">
              {totalLivePoints} pts
            </span>
          </div>
        )}
        <div className="text-mist-300">
          Formation:{" "}
          <span className="text-mist-50 font-bold">{squad.formation}</span>
        </div>
        <div className="text-mist-300">
          Value / Bank:{" "}
          <span className="text-mist-50 font-bold">
            £{squad.cost.toFixed(1)}m
          </span>{" "}
          /{" "}
          <span
            className={`font-bold ${
              squad.bank < -0.01 ? "text-danger-400" : "text-cobalt-400"
            }`}
          >
            {squad.bank < 0
              ? `-£${Math.abs(squad.bank).toFixed(1)}m`
              : `£${squad.bank.toFixed(1)}m`}
          </span>
        </div>
      </div>

      {/* Suggested Captain Banner */}
      {capInfo && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-gold-950/50 border-gold-400/40 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 bg-gold-400 text-ink-950 font-extrabold px-2 py-0.5 rounded-md text-[10px]">
              <Crown weight="fill" className="w-3 h-3 shrink-0" />
              <span>SUGGESTED CAPTAIN</span>
            </span>
            <span className="text-mist-50 font-bold">
              {capInfo.name} ({capInfo.position}
              {capInfo.team_short ? ` · ${capInfo.team_short}` : ""}):{" "}
              <span className="text-gold-400">
                {(capInfo.xp * 2).toFixed(2)} pts
              </span>{" "}
              <span className="text-mist-300 font-medium">
                (2× of {capInfo.xp.toFixed(2)} xP)
              </span>
            </span>
          </div>
          {capInfo.current_captain_name &&
            capInfo.current_captain_name !== capInfo.name && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-spark-400">
                <span>
                  Your Cap:{" "}
                  <strong className="text-mist-50">
                    {capInfo.current_captain_name}
                  </strong>{" "}
                  ({(capInfo.current_captain_xp ?? 0).toFixed(2)} xP)
                </span>
                <ArrowRight weight="bold" className="w-3 h-3 shrink-0" />
                <strong>+{(capInfo.delta_xp ?? 0).toFixed(2)} xP gain</strong>
              </span>
            )}
        </div>
      )}

      {/* Football Pitch Grid (keeps up to 5 players per row strictly in one horizontal line) */}
      <div className="relative rounded-xl border border-cobalt-500/40 bg-gradient-to-b from-ink-900 via-cobalt-950/50 to-ink-900 px-2 py-4 sm:p-5 shadow-inner flex flex-col gap-5 overflow-hidden">
        {/* Subtle Tactical Pitch Markings */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 sm:inset-3 rounded-lg border border-mist-300/10"
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[54%] sm:w-[44%] h-[17%] border-b border-x border-mist-300/10 rounded-b-sm" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[26%] sm:w-[20%] h-[7%] border-b border-x border-mist-300/10 rounded-b-sm" />
          <div className="absolute top-1/2 left-0 right-0 border-t border-mist-300/10" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 sm:w-32 sm:h-32 rounded-full border border-mist-300/10" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[54%] sm:w-[44%] h-[17%] border-t border-x border-mist-300/10 rounded-t-sm" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[26%] sm:w-[20%] h-[7%] border-t border-x border-mist-300/10 rounded-t-sm" />
        </div>

        <div className="relative z-10 flex justify-center gap-1.5 sm:gap-2.5 flex-nowrap">
          {gks.map(renderCard)}
        </div>

        <div className="relative z-10 flex justify-center gap-1.5 sm:gap-2.5 flex-nowrap">
          {defs.map(renderCard)}
        </div>

        <div className="relative z-10 flex justify-center gap-1.5 sm:gap-2.5 flex-nowrap">
          {mids.map(renderCard)}
        </div>

        <div className="relative z-10 flex justify-center gap-1.5 sm:gap-2.5 flex-nowrap">
          {fwds.map(renderCard)}
        </div>
      </div>

      {/* Horizontal Bench Strip */}
      <div
        className={`rounded-xl border p-2.5 sm:p-3.5 ${
          isBenchBoost
            ? "bg-gold-950/40 border-gold-400/60"
            : "bg-ink-900 border-ink-700"
        }`}
      >
        <div className="text-xs font-semibold text-mist-300 mb-2.5 uppercase tracking-wider flex justify-between">
          <span>
            {isBenchBoost
              ? "Bench Boost Active: All 4 Bench Players Score 1× Points"
              : "Bench (GK, Sub 1, Sub 2, Sub 3)"}
          </span>
        </div>
        <div className="flex justify-center gap-1.5 sm:gap-3 flex-nowrap">
          {bench.map((p, idx) => (
            <div
              key={p.element}
              className="flex flex-col items-center gap-1 flex-1 min-w-0 max-w-[122px]"
            >
              <span className="text-[10px] font-mono text-mist-300">
                {idx === 0 ? "BENCH GK" : `SUB ${idx}`}
              </span>
              <div className="w-full flex justify-center">
                {renderCard(p)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
