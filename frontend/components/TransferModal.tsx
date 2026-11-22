"use client";

import React, { useState } from "react";
import {
  ArrowRight,
  ArrowsLeftRight,
  Check,
  Sliders,
} from "@phosphor-icons/react";
import { PlayerCardData } from "./PlayerCard";
import { SquadData } from "./Pitch";
import { OptimusLoader } from "./ui";

export interface TransferPair {
  out: PlayerCardData;
  in: PlayerCardData;
  delta_xp: number;
  delta_price: number;
}

export interface TransferPlanItem {
  n_transfers: number;
  hits: number;
  hit_cost: number;
  gross_gain: number;
  net_gain: number;
  new_fitness: number;
  new_gw_rating_pct?: number;
  bank_after: number;
  transfers: TransferPair[];
  resulting_squad: SquadData;
}

export interface TransferResultPayload {
  base_fitness: number;
  base_gw_rating_pct?: number;
  base_squad: SquadData;
  free_transfers: number;
  horizon: number;
  recommended_free_plans: TransferPlanItem[];
  recommended_hit_plans: TransferPlanItem[];
}

export default function TransferModal({
  freeTransfers,
  onChangeFreeTransfers,
  bank,
  onChangeBank,
  includeHits,
  onToggleHits,
  onRunOptimize,
  loading,
  result,
  onApplyPlan,
}: {
  freeTransfers: number;
  onChangeFreeTransfers: (ft: number) => void;
  bank: number;
  onChangeBank: (b: number) => void;
  includeHits: boolean;
  onToggleHits: (v: boolean) => void;
  onRunOptimize: () => void;
  loading: boolean;
  result: TransferResultPayload | null;
  onApplyPlan: (squad: SquadData) => void;
}) {
  const [tab, setTab] = useState<"free" | "hits">("free");

  const plans =
    tab === "free"
      ? result?.recommended_free_plans || []
      : result?.recommended_hit_plans || [];

  return (
    <div className="bg-ink-900 border border-ink-700 rounded-xl p-4 flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 pb-2.5">
        <div className="flex items-center gap-2">
          <Sliders
            size={16}
            weight="bold"
            className="text-crimson-400 shrink-0"
            aria-hidden="true"
          />
          <h2 className="text-sm font-bold text-mist-50">
            Transfer Decision Studio (1-5 Free Transfers + Hit Explorer)
          </h2>
        </div>
        {result && (
          <span className="text-xs font-mono text-mist-300">
            Base GW Rating:{" "}
            <strong className="text-spark-400">
              {result.base_gw_rating_pct ??
                Math.min(100, Math.round((result.base_fitness / 68.5) * 100))}
              %
            </strong>
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="tm-free-transfers"
            className="text-mist-300 font-medium"
          >
            Free Transfers (1-5)
          </label>
          <select
            id="tm-free-transfers"
            value={freeTransfers}
            onChange={(e) => onChangeFreeTransfers(Number(e.target.value))}
            className="h-9 bg-ink-950 border border-ink-700 text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none rounded-md px-2.5 font-mono"
          >
            {[1, 2, 3, 4, 5].map((ft) => (
              <option key={ft} value={ft}>
                {ft} FT
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="tm-bank" className="text-mist-300 font-medium">
            Bank (£m)
          </label>
          <input
            id="tm-bank"
            type="number"
            step="0.1"
            min="0"
            value={bank}
            onChange={(e) => onChangeBank(parseFloat(e.target.value) || 0)}
            placeholder="0.0"
            className="h-9 bg-ink-950 border border-ink-700 text-mist-50 placeholder:text-mist-400 focus:border-cobalt-400 focus:outline-none rounded-md px-2.5 font-mono"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-mist-300 font-medium">Hit Strategy</span>
          <label
            htmlFor="hits-toggle"
            className="h-9 flex items-center gap-2 px-2.5 bg-ink-950 border border-ink-700 text-mist-300 hover:border-cobalt-400/60 rounded-md cursor-pointer transition-colors"
          >
            <input
              id="hits-toggle"
              type="checkbox"
              checked={includeHits}
              onChange={(e) => onToggleHits(e.target.checked)}
              className="rounded-md accent-crimson-500 h-3.5 w-3.5 cursor-pointer"
            />
            <span>Include -4pt Hits</span>
          </label>
        </div>

        <div className="flex flex-col justify-end">
          <button
            type="button"
            onClick={onRunOptimize}
            disabled={loading}
            className="w-full h-9 inline-flex items-center justify-center gap-1.5 whitespace-nowrap bg-crimson-500 hover:bg-crimson-400 disabled:opacity-45 disabled:cursor-not-allowed text-mist-50 rounded-md font-bold py-1.5 px-3 transition active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
          >
            <ArrowsLeftRight size={15} weight="bold" aria-hidden="true" />
            <span>{loading ? "Solving..." : "Find Top Transfers"}</span>
          </button>
        </div>
      </div>

      {/* Optimus Loading Surface */}
      {loading && (
        <OptimusLoader
          mode="compact"
          label="Solving Optimal Transfers"
          sublabel="Evaluating 1-5 free transfers & -4pt hit combinations"
        />
      )}

      {/* Sub-tabs: Free Plans vs Hit Plans */}
      {!loading && result && (
        <>
          <div className="flex flex-wrap gap-2 border-b border-ink-700 pb-2.5 text-xs">
            <button
              type="button"
              onClick={() => setTab("free")}
              className={`px-3 py-1.5 rounded-md font-semibold whitespace-nowrap transition active:scale-[0.98] cursor-pointer ${
                tab === "free"
                  ? "bg-cobalt-500 text-mist-50"
                  : "bg-ink-800 hover:bg-ink-700 text-mist-300"
              }`}
            >
              Within Free Transfers ({result.recommended_free_plans.length})
            </button>
            {includeHits && (
              <button
                type="button"
                onClick={() => setTab("hits")}
                className={`px-3 py-1.5 rounded-md font-semibold whitespace-nowrap transition active:scale-[0.98] cursor-pointer ${
                  tab === "hits"
                    ? "bg-cobalt-500 text-mist-50"
                    : "bg-ink-800 hover:bg-ink-700 text-mist-300"
                }`}
              >
                With Point Hits ({result.recommended_hit_plans.length})
              </button>
            )}
          </div>

          {/* Plan Cards */}
          <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1">
            {plans.length === 0 ? (
              <div className="text-xs text-mist-300 py-5 px-3 text-center bg-ink-950 border border-ink-700 rounded-xl">
                No plans in this category.
              </div>
            ) : (
              plans.map((plan, idx) => (
                <div
                  key={idx}
                  className="bg-ink-950 border border-ink-700 rounded-xl p-3 flex flex-col gap-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                    <span className="font-bold text-mist-50">
                      Plan #{idx + 1} · {plan.n_transfers} Transfer
                      {plan.n_transfers > 1 ? "s" : ""}
                      {plan.hits > 0 && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md bg-danger-950 text-danger-400 border border-danger-400/50 text-[11px]">
                          -{plan.hit_cost}pt hit
                        </span>
                      )}
                    </span>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {plan.new_gw_rating_pct !== undefined && (
                        <span className="text-cobalt-400 font-bold">
                          GW Rating: {plan.new_gw_rating_pct}%
                        </span>
                      )}
                      <span
                        className={`font-bold px-2 py-0.5 rounded-md border ${
                          plan.net_gain >= 0
                            ? "bg-spark-950 text-spark-400 border-spark-400/40"
                            : "bg-danger-950 text-danger-400 border-danger-400/50"
                        }`}
                      >
                        {plan.net_gain >= 0 ? "+" : ""}
                        {plan.net_gain.toFixed(2)} Net xP
                      </span>
                      <span className="text-mist-300">
                        Bank: £{plan.bank_after.toFixed(1)}m
                      </span>
                      <button
                        type="button"
                        onClick={() => onApplyPlan(plan.resulting_squad)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-cobalt-500 hover:bg-cobalt-400 text-mist-50 px-2.5 py-1 font-sans font-semibold transition active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75"
                      >
                        <Check size={12} weight="bold" aria-hidden="true" />
                        <span>Preview on Pitch</span>
                      </button>
                    </div>
                  </div>

                  {/* Out -> In Diff Rows */}
                  <div className="flex flex-col gap-1.5">
                    {plan.transfers.map((tr, tIdx) => (
                      <div
                        key={tIdx}
                        className="flex flex-col gap-1.5 bg-ink-900/90 px-2.5 py-2 rounded-md border border-ink-700"
                      >
                        <div className="flex items-center justify-between gap-2 text-danger-400">
                          <span className="truncate">
                            <strong>OUT:</strong> {tr.out.name} ({tr.out.position} ·{" "}
                            {tr.out.team_short})
                          </span>
                          <span className="font-mono shrink-0">
                            £{tr.out.price.toFixed(1)}m · {tr.out.xp.toFixed(2)} xP
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-spark-400 pt-1 border-t border-ink-800/70">
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <ArrowRight
                              size={13}
                              weight="bold"
                              className="text-mist-300 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              <strong>IN:</strong> {tr.in.name} ({tr.in.position} ·{" "}
                              {tr.in.team_short})
                            </span>
                          </span>
                          <span className="font-mono shrink-0">
                            £{tr.in.price.toFixed(1)}m · {tr.in.xp.toFixed(2)} xP (
                            {tr.delta_xp >= 0 ? "+" : ""}
                            {tr.delta_xp.toFixed(2)})
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
