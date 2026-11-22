"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowsLeftRight,
  Check,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { PlayerCardData } from "./PlayerCard";

export interface PoolPlayerItem {
  element: number;
  name: string;
  full_name?: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  team_id: number;
  team_short?: string;
  price: number;
  xp_base: number;
  p_defcon: number;
  xp: number;
  fdr?: number;
  was_home?: number;
  opponent_short?: string;
  status?: string;
  news?: string;
  archetype?: string;
}

const FDR_BADGE: Record<number, string> = {
  1: "bg-spark-950 text-spark-400 border border-spark-400/40",
  2: "bg-cobalt-500 text-mist-50 border border-cobalt-400/40",
  3: "bg-ink-800 text-mist-300 border border-ink-700",
  4: "bg-gold-950 text-gold-400 border border-gold-400/50",
  5: "bg-crimson-500 text-mist-50 border border-crimson-400/50",
};

export default function ManualTransferPanel({
  selectedGw,
  currentSquadPlayers,
  playerMarket,
  selectedOut,
  freeTransfers,
  onChangeFreeTransfers,
  bank,
  nTransfers,
  hitCost,
  projectedPoints,
  gwRatingPct,
  violations,
  hasPendingChanges,
  evalLoading,
  confirmError,
  onClearSelectedOut,
  onSelectTransferIn,
  onRefreshProjection,
  onConfirmTransfers,
  onResetTransfers,
  onExitTransfers,
}: {
  selectedGw: number;
  currentSquadPlayers: PlayerCardData[];
  playerMarket: PoolPlayerItem[];
  selectedOut: PlayerCardData | null;
  freeTransfers: number;
  onChangeFreeTransfers: (ft: number) => void;
  bank: number;
  nTransfers: number;
  hitCost: number;
  projectedPoints: number;
  gwRatingPct: number;
  violations: string[];
  hasPendingChanges: boolean;
  evalLoading: boolean;
  confirmError: string | null;
  onClearSelectedOut: () => void;
  onSelectTransferIn: (outPlayer: PlayerCardData, inPlayer: PoolPlayerItem) => void;
  onRefreshProjection: () => void;
  onConfirmTransfers: () => void;
  onResetTransfers: () => void;
  onExitTransfers: () => void;
}) {
  const [search, setSearch] = useState<string>("");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [clubFilter, setClubFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"xp" | "price_desc" | "price_asc" | "defcon">("xp");

  const activePos = selectedOut ? selectedOut.position : posFilter;
  const squadElementSet = useMemo(
    () => new Set(currentSquadPlayers.map((p) => p.element)),
    [currentSquadPlayers]
  );

  // Count how many players are currently in the draft from each club (excluding `selectedOut`)
  const clubCountsExclOut = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const p of currentSquadPlayers) {
      if (selectedOut && p.element === selectedOut.element) continue;
      counts[p.team_id] = (counts[p.team_id] || 0) + 1;
    }
    return counts;
  }, [currentSquadPlayers, selectedOut]);

  const clubs = useMemo(() => {
    const set = new Set<string>();
    for (const p of playerMarket) {
      if (p.team_short) set.add(p.team_short);
    }
    return Array.from(set).sort();
  }, [playerMarket]);

  const filteredMarket = useMemo(() => {
    const q = search.trim().toLowerCase();
    return playerMarket
      .filter((p) => {
        if (squadElementSet.has(p.element)) return false;
        if (activePos !== "ALL" && p.position !== activePos) return false;
        if (clubFilter !== "ALL" && p.team_short !== clubFilter) return false;
        if (
          q &&
          !p.name.toLowerCase().includes(q) &&
          !(p.full_name || "").toLowerCase().includes(q) &&
          !(p.team_short || "").toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "xp") return (b.xp ?? 0) - (a.xp ?? 0);
        if (sortBy === "price_desc") return b.price - a.price;
        if (sortBy === "price_asc") return a.price - b.price;
        return (b.p_defcon ?? 0) - (a.p_defcon ?? 0);
      })
      .slice(0, 60);
  }, [playerMarket, squadElementSet, activePos, clubFilter, search, sortBy]);

  return (
    <div className="border border-cobalt-500/50 bg-ink-900 rounded-xl p-4 flex flex-col gap-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ink-700 pb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ArrowsLeftRight
              size={16}
              weight="bold"
              className="text-cobalt-400 shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-sm font-bold text-mist-50">
              Manual Transfers · GW{selectedGw} Planner
            </h2>
          </div>
          <p className="text-[11px] text-mist-300 mt-1">
            Preview any same-position transfer (even over budget or club cap) to inspect points; FPL rules checked on Confirm.
          </p>
        </div>
        <button
          type="button"
          onClick={onExitTransfers}
          className="rounded-md bg-ink-800 hover:bg-ink-700 border border-ink-700 text-mist-50 px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition active:scale-[0.98] cursor-pointer"
        >
          Done
        </button>
      </div>

      {/* Summary Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono bg-ink-950 border border-ink-700 rounded-lg p-2.5">
        <div>
          <span className="text-mist-300 block text-[10px]">Transfers / FT</span>
          <strong className="text-mist-50">
            {nTransfers} / {freeTransfers} FT
          </strong>
          {hitCost > 0 && (
            <span className="text-danger-400 ml-1">(-{hitCost}pt)</span>
          )}
        </div>
        <div>
          <span className="text-mist-300 block text-[10px]">Remaining Bank</span>
          <strong className={bank < -0.01 ? "text-danger-400" : "text-cobalt-400"}>
            {bank < 0 ? `-£${Math.abs(bank).toFixed(1)}m` : `£${bank.toFixed(1)}m`}
          </strong>
        </div>
        <div>
          <span className="text-mist-300 block text-[10px]">Projected GW xP</span>
          <strong className="text-spark-400">
            {projectedPoints.toFixed(1)} pts
          </strong>
        </div>
        <div>
          <span className="text-mist-300 block text-[10px]">GW Rating</span>
          <strong className="text-gold-400">{gwRatingPct}%</strong>
        </div>
      </div>

      {/* Controls: FT + Refresh + Confirm + Reset */}
      <div className="flex flex-wrap items-end justify-between gap-2.5 text-xs">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="mtp-free-transfers"
            className="text-mist-300 text-[11px] font-medium"
          >
            Free Transfers
          </label>
          <select
            id="mtp-free-transfers"
            value={freeTransfers}
            onChange={(e) => onChangeFreeTransfers(Number(e.target.value))}
            className="h-8 bg-ink-950 border border-ink-700 text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none rounded-md px-2 font-mono"
          >
            {[1, 2, 3, 4, 5].map((ft) => (
              <option key={ft} value={ft}>
                {ft} FT
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={evalLoading}
            onClick={onRefreshProjection}
            className="h-8 inline-flex items-center gap-1.5 whitespace-nowrap bg-cobalt-500 hover:bg-cobalt-400 disabled:opacity-45 disabled:cursor-not-allowed text-mist-50 rounded-md font-semibold px-2.5 transition active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
          >
            <ArrowClockwise
              size={14}
              weight="bold"
              className={evalLoading ? "animate-spin" : ""}
              aria-hidden="true"
            />
            <span>
              {evalLoading ? "Refreshing..." : "Refresh Pts & GW Rating"}
            </span>
          </button>
          <button
            type="button"
            disabled={!hasPendingChanges || evalLoading}
            onClick={onConfirmTransfers}
            className="h-8 inline-flex items-center gap-1.5 whitespace-nowrap bg-crimson-500 hover:bg-crimson-400 disabled:opacity-40 disabled:cursor-not-allowed text-mist-50 rounded-md font-bold px-3 transition active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
          >
            <Check size={14} weight="bold" aria-hidden="true" />
            <span>Confirm Transfers</span>
          </button>
          {hasPendingChanges && (
            <button
              type="button"
              onClick={onResetTransfers}
              className="h-8 inline-flex items-center gap-1 whitespace-nowrap bg-danger-950 hover:bg-danger-400/20 border border-danger-400/50 text-danger-400 rounded-md font-semibold px-2.5 transition active:scale-[0.98] cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Explicit Confirmation Failure or Violation Alert */}
      {(confirmError || violations.length > 0) && (
        <div className="rounded-lg bg-danger-950/75 border border-danger-400/60 px-3 py-2 text-xs text-mist-50 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 font-bold text-danger-400">
            <WarningCircle size={14} weight="bold" aria-hidden="true" />
            <span>
              {confirmError
                ? confirmError
                : "FPL Rule Check (must be resolved to Confirm):"}
            </span>
          </div>
          {violations.length > 0 && (
            <ul className="list-disc list-inside text-[11px] font-mono text-mist-50">
              {violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Selected Outgoing Player Box */}
      <div className="rounded-lg bg-ink-950 border border-ink-700 px-3 py-2 text-xs flex items-center justify-between gap-2">
        {selectedOut ? (
          <>
            <div className="min-w-0">
              <span className="text-danger-400 font-bold uppercase mr-1.5">
                OUT:
              </span>
              <strong className="text-mist-50">{selectedOut.name}</strong>{" "}
              <span className="text-mist-300 font-mono">
                ({selectedOut.position} · {selectedOut.team_short} · £
                {selectedOut.price.toFixed(1)}m · {selectedOut.xp.toFixed(2)} xP)
              </span>
            </div>
            <button
              type="button"
              onClick={onClearSelectedOut}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-ink-800 hover:bg-ink-700 text-mist-300 hover:text-mist-50 px-2 py-0.5 text-[11px] font-medium transition cursor-pointer shrink-0"
            >
              <span>Clear</span>
              <X size={12} weight="bold" aria-hidden="true" />
            </button>
          </>
        ) : (
          <span className="text-mist-300">
            Click any player on the pitch/bench to select them as{" "}
            <strong className="text-danger-400">Transfer Out</strong>.
          </span>
        )}
      </div>

      {/* Filters for Player Market */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="col-span-2 sm:col-span-1 flex flex-col gap-1">
          <label
            htmlFor="mtp-search"
            className="text-mist-300 text-[11px] font-medium"
          >
            Search
          </label>
          <input
            id="mtp-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Player or club..."
            className="h-8 bg-ink-950 border border-ink-700 text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none rounded-md px-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="mtp-pos"
            className="text-mist-300 text-[11px] font-medium"
          >
            Position
          </label>
          <select
            id="mtp-pos"
            value={activePos}
            disabled={Boolean(selectedOut)}
            onChange={(e) => setPosFilter(e.target.value)}
            className="h-8 bg-ink-950 border border-ink-700 text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none rounded-md px-2 font-mono disabled:opacity-65"
          >
            <option value="ALL">All Pos</option>
            <option value="GK">GK</option>
            <option value="DEF">DEF</option>
            <option value="MID">MID</option>
            <option value="FWD">FWD</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="mtp-club"
            className="text-mist-300 text-[11px] font-medium"
          >
            Club
          </label>
          <select
            id="mtp-club"
            value={clubFilter}
            onChange={(e) => setClubFilter(e.target.value)}
            className="h-8 bg-ink-950 border border-ink-700 text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none rounded-md px-2 font-mono"
          >
            <option value="ALL">All Clubs</option>
            {clubs.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="mtp-sort"
            className="text-mist-300 text-[11px] font-medium"
          >
            Sort By
          </label>
          <select
            id="mtp-sort"
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as "xp" | "price_desc" | "price_asc" | "defcon"
              )
            }
            className="h-8 bg-ink-950 border border-ink-700 text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none rounded-md px-2 font-mono"
          >
            <option value="xp">xP (High)</option>
            <option value="price_desc">Price (High)</option>
            <option value="price_asc">Price (Low)</option>
            <option value="defcon">DefCon %</option>
          </select>
        </div>
      </div>

      {/* Player List */}
      <div className="max-h-72 overflow-y-auto flex flex-col gap-1.5 pr-1">
        {filteredMarket.map((p) => {
          const newBankIfSwapped = selectedOut
            ? Number((bank + selectedOut.price - p.price).toFixed(1))
            : bank;
          const clubAfter = (clubCountsExclOut[p.team_id] || 0) + 1;
          const overBudget = Boolean(selectedOut && newBankIfSwapped < -0.01);
          const overClubCap = Boolean(selectedOut && clubAfter > 3);
          const fdrCls = FDR_BADGE[p.fdr ?? 3] || FDR_BADGE[3];

          return (
            <div
              key={p.element}
              className="flex items-center justify-between gap-2 bg-ink-950 hover:bg-ink-800/80 border border-ink-700 rounded-md px-2.5 py-2 text-xs transition-colors"
            >
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-bold text-mist-50 truncate">{p.name}</span>
                  <span className="text-[11px] font-mono text-mist-300 shrink-0">
                    {p.position} · {p.team_short}
                  </span>
                  {p.status && p.status !== "a" && (
                    <span
                      title={p.news || "Availability flag"}
                      className="text-[10px] bg-gold-400 text-ink-950 font-bold px-1.5 py-0.5 rounded-md uppercase shrink-0"
                    >
                      {p.status === "d" ? "75%" : p.status}
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono font-semibold shrink-0 ${fdrCls}`}
                  >
                    {p.opponent_short || "FIX"} ({p.was_home === 0 ? "A" : "H"})
                  </span>
                </div>
                {selectedOut && (overBudget || overClubCap) && (
                  <div className="flex flex-wrap gap-2 mt-0.5 text-[10px] font-mono">
                    {overBudget && (
                      <span className="text-danger-400">
                        Over budget (-£{Math.abs(newBankIfSwapped).toFixed(1)}m)
                      </span>
                    )}
                    {overClubCap && (
                      <span className="text-gold-400">
                        4 players from {p.team_short}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5 shrink-0 font-mono">
                <div className="text-right">
                  <div className="text-mist-50 font-semibold">
                    £{p.price.toFixed(1)}m
                  </div>
                  <div className="text-[10px] text-spark-400 font-bold">
                    {(p.xp ?? 0).toFixed(2)} xP
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!selectedOut}
                  onClick={() => selectedOut && onSelectTransferIn(selectedOut, p)}
                  title={
                    selectedOut
                      ? `Preview ${selectedOut.name} to ${p.name}`
                      : "Select a player on the pitch first"
                  }
                  className={`rounded-md px-2.5 py-1 font-sans text-[11px] font-bold whitespace-nowrap transition active:scale-[0.98] ${
                    !selectedOut
                      ? "bg-ink-800 text-mist-400 border border-ink-700 cursor-not-allowed"
                      : overBudget || overClubCap
                      ? "bg-gold-400 hover:bg-gold-400/90 text-ink-950 cursor-pointer"
                      : "bg-crimson-500 hover:bg-crimson-400 text-mist-50 cursor-pointer"
                  }`}
                >
                  {overBudget || overClubCap ? "Preview" : "Swap In"}
                </button>
              </div>
            </div>
          );
        })}
        {filteredMarket.length === 0 && (
          <div className="text-center text-xs text-mist-300 py-5 bg-ink-950 border border-ink-700 rounded-md">
            No matching players found.
          </div>
        )}
      </div>
    </div>
  );
}
