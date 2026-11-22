"use client";

import React, { useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { Button, Panel } from "./ui";

export interface ChipStatusItem {
  chip: string;
  label: string;
  window: string;
  status: "available" | "used" | "active" | "expired";
  used_gw: number | null;
}

export interface ManagerInfo {
  team_id: number;
  manager_name: string;
  team_name: string;
  region?: string;
  overall_points: number;
  overall_rank: number | null;
  event_points: number;
  value: number;
  bank: number;
  chip_status?: ChipStatusItem[];
}

export default function ManagerBar({
  onLoadManager,
  managerInfo,
  chipStatus,
  activeChip,
  loading,
  currentGw,
  selectedGw,
  onChangeGw,
  onRefreshLive,
}: {
  onLoadManager: (teamId: number) => void;
  managerInfo: ManagerInfo | null;
  chipStatus?: ChipStatusItem[];
  activeChip?: string | null;
  loading: boolean;
  currentGw: number;
  selectedGw: number;
  onChangeGw: (gw: number) => void;
  onRefreshLive: () => void;
}) {
  const [teamIdInput, setTeamIdInput] = useState<string>("81552");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseInt(teamIdInput.trim(), 10);
    if (!isNaN(id) && id > 0) {
      onLoadManager(id);
    }
  };

  const chips = chipStatus || managerInfo?.chip_status || [];

  return (
    <Panel variant="default" className="p-3.5 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Left: Manager Lookup Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-1">
          <label
            htmlFor="fpl-team-id"
            className="text-[11px] font-semibold text-mist-300"
          >
            FPL Team ID
          </label>
          <div className="flex items-center gap-2">
            <input
              id="fpl-team-id"
              type="number"
              min={1}
              value={teamIdInput}
              onChange={(e) => setTeamIdInput(e.target.value)}
              placeholder="e.g. 81552"
              className="w-32 h-8 rounded-md bg-ink-950 border border-ink-700 px-2.5 text-xs font-mono text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none transition-colors"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={loading}
              className="bg-crimson-500 hover:bg-crimson-400 text-mist-50 rounded-md"
            >
              {loading ? "Loading..." : "Load Manager Squad"}
            </Button>
          </div>
        </form>

        {/* Center: Loaded Manager Details */}
        {managerInfo && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-mono bg-ink-950 px-3 py-2 rounded-md border border-ink-700">
            <div>
              <span className="text-mist-300">Team:</span>{" "}
              <span className="text-mist-50 font-bold">
                {managerInfo.team_name}
              </span>{" "}
              <span className="text-mist-300">
                ({managerInfo.manager_name})
              </span>
            </div>
            <div>
              <span className="text-mist-300">Overall Pts:</span>{" "}
              <span className="text-spark-400 font-bold tabular-nums">
                {managerInfo.overall_points}
              </span>
            </div>
            <div>
              <span className="text-mist-300">Rank:</span>{" "}
              <span className="text-cobalt-400 font-bold tabular-nums">
                {managerInfo.overall_rank
                  ? managerInfo.overall_rank.toLocaleString()
                  : "N/A"}
              </span>
            </div>
            <div>
              <span className="text-mist-300">Value/Bank:</span>{" "}
              <span className="text-mist-50 tabular-nums">
                £{managerInfo.value.toFixed(1)}m / £{managerInfo.bank.toFixed(1)}
                m
              </span>
            </div>
          </div>
        )}

        {/* Right: Gameweek Selector (auto-reloads squad & projections on change) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="gw-selector"
            className="text-[11px] font-semibold text-mist-300"
          >
            Gameweek
          </label>
          <div className="flex items-center gap-2 text-xs">
            <select
              id="gw-selector"
              value={selectedGw}
              onChange={(e) => onChangeGw(Number(e.target.value))}
              className="h-8 rounded-md bg-ink-950 border border-ink-700 px-2.5 text-xs font-mono text-mist-50 focus:border-cobalt-400 focus:outline-none transition-colors"
            >
              {Array.from({ length: 38 }, (_, i) => i + 1).map((g) => (
                <option key={g} value={g}>
                  GW {g}
                  {g === currentGw
                    ? " (Current)"
                    : g === currentGw + 1
                    ? " (Next)"
                    : g > currentGw + 1
                    ? " (Projected)"
                    : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefreshLive}
              className="text-spark-400 border-ink-700 hover:border-cobalt-400"
            >
              <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
              <span>Sync Live Points</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom Strip: 8-Chip Season Tracker (2x WC, 2x FH, 2x BB, 2x TC) */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-ink-700 text-[11px] font-mono">
          <span className="text-mist-300 font-sans font-semibold mr-1">
            Chips (2 per season · click used chip to jump to GW):
          </span>
          {chips.map((c) => {
            const isActiveThisGw =
              c.status === "active" ||
              (c.used_gw !== null && c.used_gw === selectedGw) ||
              (activeChip !== undefined && activeChip !== null && activeChip === c.chip && c.used_gw === selectedGw);
            let badgeStyle =
              "bg-cobalt-950 text-cobalt-400 border-cobalt-500/50";
            let statusText = "Avail";
            if (isActiveThisGw) {
              badgeStyle =
                "bg-gold-400 text-ink-950 border-gold-400 font-bold";
              statusText = `ACTIVE GW${c.used_gw}`;
            } else if (c.status === "used" && c.used_gw) {
              badgeStyle =
                "bg-ink-800 text-mist-300 border-ink-700 hover:border-cobalt-400 cursor-pointer";
              statusText = `Used GW${c.used_gw}`;
            } else if (c.status === "expired") {
              badgeStyle =
                "bg-ink-950 text-mist-400 border-ink-700 opacity-65";
              statusText = "Expired";
            }
            return (
              <button
                key={c.label}
                type="button"
                disabled={!c.used_gw}
                onClick={() => c.used_gw && onChangeGw(c.used_gw)}
                title={`${c.label} (${c.window}) · ${statusText}`}
                className={`px-2 py-0.5 rounded-md border transition active:scale-[0.98] ${badgeStyle}`}
              >
                {c.label}: {statusText}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
