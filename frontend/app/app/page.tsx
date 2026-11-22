"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  ArrowsLeftRight,
  ChartBar,
  Lightning,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import AppHeader from "../../components/app/AppHeader";
import { Badge, OptimusLoader, Panel } from "../../components/ui";
import ManagerBar, { ChipStatusItem, ManagerInfo } from "../../components/ManagerBar";
import Pitch, { SquadData, SuggestedCaptainInfo } from "../../components/Pitch";
import { PlayerCardData } from "../../components/PlayerCard";
import TransferModal, { TransferResultPayload } from "../../components/TransferModal";
import ManualTransferPanel, { PoolPlayerItem } from "../../components/ManualTransferPanel";
import Charts, { ConvergencePoint } from "../../components/Charts";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface OptimusBundle {
  anchor_gw: number;
  freehit: {
    start_gw: number;
    end_gw: number;
    n_gws: number;
    budget: number;
    squad: SquadData;
    convergence: ConvergencePoint[];
  };
  wildcard: {
    start_gw: number;
    end_gw: number;
    n_gws: number;
    budget: number;
    squad: SquadData;
    convergence: ConvergencePoint[];
  };
}

interface DraftSquadState {
  fromGw: number;
  squad: SquadData;
  originElements: number[];
  sellingBudget: number;
  nTransfers: number;
  hitCost: number;
  violations: string[];
  confirmed: boolean;
}

function canSwapPlayers(
  starters: PlayerCardData[],
  bench: PlayerCardData[],
  a: PlayerCardData,
  b: PlayerCardData
): boolean {
  if (a.element === b.element) return false;
  const aIdxB = bench.findIndex((p) => p.element === a.element);
  const bIdxB = bench.findIndex((p) => p.element === b.element);
  const aIsStarter = aIdxB === -1;
  const bIsStarter = bIdxB === -1;

  // Two starters cannot swap with each other (order is visual by position)
  if (aIsStarter && bIsStarter) return false;

  // Two bench players: outfield subs (indices 1..3) can reorder; bench GK (index 0) is fixed
  if (!aIsStarter && !bIsStarter) {
    return aIdxB > 0 && bIdxB > 0;
  }

  // One starter, one bench player
  const starter = aIsStarter ? a : b;
  const benchPlayer = aIsStarter ? b : a;
  if (starter.position === "GK" || benchPlayer.position === "GK") {
    return starter.position === "GK" && benchPlayer.position === "GK";
  }

  const nextStarters = starters.map((p) =>
    p.element === starter.element ? benchPlayer : p
  );
  let def = 0;
  let mid = 0;
  let fwd = 0;
  for (const p of nextStarters) {
    if (p.position === "DEF") def += 1;
    else if (p.position === "MID") mid += 1;
    else if (p.position === "FWD") fwd += 1;
  }
  return def >= 3 && mid >= 2 && fwd >= 1;
}

function computeLocalSquadMetrics(
  starters: PlayerCardData[],
  bench: PlayerCardData[],
  sellingBudget: number,
  activeChip: string | null,
  optimalFitness: number
): {
  projected_points: number;
  fitness: number;
  gw_rating_pct: number;
  cost: number;
  bank: number;
  formation: string;
  violations: string[];
} {
  const all = [...starters, ...bench];
  const cost = Number(all.reduce((s, p) => s + p.price, 0).toFixed(1));
  const bank = Number((sellingBudget - cost).toFixed(1));
  const violations: string[] = [];
  if (cost > sellingBudget + 0.001) {
    violations.push(
      `Over budget by £${(cost - sellingBudget).toFixed(1)}m (£${cost.toFixed(1)}m > £${sellingBudget.toFixed(1)}m).`
    );
  }
  const clubCounts: Record<number, { count: number; name: string }> = {};
  for (const p of all) {
    const cur = clubCounts[p.team_id] || { count: 0, name: p.team_short || `Team ${p.team_id}` };
    clubCounts[p.team_id] = { count: cur.count + 1, name: cur.name };
  }
  for (const entry of Object.values(clubCounts)) {
    if (entry.count > 3) {
      violations.push(`${entry.count} players from ${entry.name} (max 3 allowed).`);
    }
  }

  const def = starters.filter((p) => p.position === "DEF").length;
  const mid = starters.filter((p) => p.position === "MID").length;
  const fwd = starters.filter((p) => p.position === "FWD").length;
  const formation = `${def}-${mid}-${fwd}`;

  const startersXp = starters.reduce((s, p) => {
    const mult = p.is_captain ? (activeChip === "3xc" ? 3 : 2) : 1;
    return s + p.xp * mult;
  }, 0);
  const benchXp = bench.reduce((s, p) => s + p.xp, 0);
  const projected_points = Number(
    (startersXp + (activeChip === "bboost" ? benchXp : 0)).toFixed(2)
  );

  const capCard = starters.find((p) => p.is_captain) || starters[0];
  const rawFitness =
    starters.reduce((s, p) => s + p.xp, 0) +
    (capCard?.xp ?? 0) +
    0.1 * benchXp;
  const gw_rating_pct =
    optimalFitness > 0
      ? Math.min(100, Math.max(1, Math.round((100 * rawFitness) / optimalFitness)))
      : 75;

  return {
    projected_points,
    fitness: Number(rawFitness.toFixed(2)),
    gw_rating_pct,
    cost,
    bank,
    formation,
    violations,
  };
}

export default function HomePage() {
  // Global bootstrap state
  const [season, setSeason] = useState<string>("2025-26");
  const [currentGw, setCurrentGw] = useState<number>(10);
  const [selectedGw, setSelectedGw] = useState<number>(10);
  const [sourceMode, setSourceMode] = useState<string>("loading...");
  const [fullPlayersPool, setFullPlayersPool] = useState<PoolPlayerItem[]>([]);
  const [gmmPlayersPool, setGmmPlayersPool] = useState<any[]>([]);
  const [optimalFitness, setOptimalFitness] = useState<number>(68.0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Squad view tabs: Current Manager Squad | Optimus Freehit (1 GW) | Optimus Wildcard (5 GWs)
  const [activeTab, setActiveTab] = useState<"current" | "freehit" | "wildcard">("freehit");
  const [pitchSubMode, setPitchSubMode] = useState<"overview" | "pick_team" | "transfers">("overview");

  // Manager official squad + interactive Draft Squad for Next/Projected GWs
  const [officialManagerSquad, setOfficialManagerSquad] = useState<SquadData | null>(null);
  const [draftState, setDraftState] = useState<DraftSquadState | null>(null);
  const [sellingBudget, setSellingBudget] = useState<number>(100.0);

  // Optimus Freehit & Wildcard (both strictly 5,000 SA iterations)
  const [optimusData, setOptimusData] = useState<OptimusBundle | null>(null);
  const [optimusBudget, setOptimusBudget] = useState<number>(100.0);
  const [optimusLoading, setOptimusLoading] = useState<boolean>(false);

  // Manager metadata
  const [managerInfo, setManagerInfo] = useState<ManagerInfo | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [chipStatus, setChipStatus] = useState<ChipStatusItem[]>([]);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [isFutureProjection, setIsFutureProjection] = useState<boolean>(false);
  const [picksSourceGw, setPicksSourceGw] = useState<number | null>(null);
  const [suggestedCapCompare, setSuggestedCapCompare] = useState<SuggestedCaptainInfo | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCardData | null>(null);

  // Interactive Pick Team & Transfers UI state
  const [selectedPitchElement, setSelectedPitchElement] = useState<number | null>(null);
  const [evalLoading, setEvalLoading] = useState<boolean>(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Transfer Decision Studio (AI) controls
  const [freeTransfers, setFreeTransfers] = useState<number>(1);
  const [bank, setBank] = useState<number>(0.0);
  const [includeHits, setIncludeHits] = useState<boolean>(true);
  const [transferLoading, setTransferLoading] = useState<boolean>(false);
  const [transferResult, setTransferResult] = useState<TransferResultPayload | null>(null);

  // Live points & Offline Benchmarks
  const [liveMap, setLiveMap] = useState<
    Record<number, { total_points: number; defcon_count: number; defcon_hit: boolean }>
  >({});
  const [benchmarks, setBenchmarks] = useState<any | null>(null);
  const [managerLoading, setManagerLoading] = useState<boolean>(false);

  const isNextOrProjected = selectedGw >= currentGw + 1;

  // Fetch Bootstrap player pool for a specific GW
  const fetchBootstrapForGw = async (gw?: number) => {
    try {
      const q = gw ? `?gw=${gw}&horizon=1` : `?horizon=1`;
      const res = await fetch(`${API_BASE}/api/bootstrap${q}`);
      if (!res.ok) return null;
      const boot = await res.json();
      setSeason(boot.season);
      if (boot.current_gw) setCurrentGw(boot.current_gw);
      setOptimalFitness(boot.optimal_fitness || 68.0);
      setSourceMode(
        boot.from_cache_fallback
          ? `${boot.source} (cached fallback)`
          : boot.source
      );
      setFullPlayersPool(boot.players || []);
      setGmmPlayersPool(boot.gmm_players || boot.players || []);
      return boot;
    } catch {
      return null;
    }
  };

  // Fetch BOTH 5k-SA Optimus squads: Optimus Freehit (1 GW) & Optimus Wildcard (5 GWs)
  const fetchOptimusSquads = async (
    targetGw?: number,
    budgetToUse = optimusBudget,
    force = false
  ) => {
    setOptimusLoading(true);
    try {
      const params = new URLSearchParams();
      if (targetGw) params.set("gw", String(targetGw));
      params.set("budget", String(budgetToUse));
      if (force) params.set("force", "true");
      const res = await fetch(`${API_BASE}/api/optimus/squads?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to build Optimus squads");
      }
      const data: OptimusBundle = await res.json();
      setOptimusData(data);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setOptimusLoading(false);
    }
  };

  // Sync live GW points & DefCon counts
  const handleSyncLive = async (gwToFetch = selectedGw) => {
    try {
      const res = await fetch(`${API_BASE}/api/live/${gwToFetch}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.is_future) {
        setLiveMap({});
        return;
      }
      const map: Record<
        number,
        { total_points: number; defcon_count: number; defcon_hit: boolean }
      > = {};
      for (const el of data.elements || []) {
        map[el.element] = {
          total_points: el.total_points,
          defcon_count: el.defcon_count,
          defcon_hit: el.defcon_hit,
        };
      }
      setLiveMap(map);
    } catch {
      // Quietly ignore live polling errors
    }
  };

  // Initial load: bootstrap + benchmarks + Optimus Freehit & Wildcard (5k SA)
  useEffect(() => {
    const init = async () => {
      try {
        const [boot, benchRes] = await Promise.all([
          fetchBootstrapForGw(),
          fetch(`${API_BASE}/api/benchmarks`),
        ]);
        if (boot) {
          const curGw = boot.current_gw || 10;
          setSelectedGw(curGw);
          await Promise.all([
            handleSyncLive(curGw),
            fetchOptimusSquads(curGw, 100.0),
          ]);
        } else {
          setErrorMsg(
            `Could not connect to backend at ${API_BASE}. Make sure FastAPI is running on port 8000.`
          );
        }
        if (benchRes.ok) {
          setBenchmarks(await benchRes.json());
        }
      } catch {
        setErrorMsg(
          `Could not connect to backend at ${API_BASE}. Make sure FastAPI is running on port 8000.`
        );
      }
    };
    init();
  }, []);

  // Backend squad evaluator (recalculates Projected Pts, GW Rating %, Suggested Captain, & FPL violations)
  const evaluateDraftOnServer = async (
    draft: DraftSquadState,
    gwToEval: number,
    enforceConstraints = false,
    ftOverride = freeTransfers
  ): Promise<{ valid: boolean; violations: string[]; updated?: DraftSquadState }> => {
    setEvalLoading(true);
    setConfirmError(null);
    try {
      const cap =
        draft.squad.starters.find((p) => p.is_captain)?.element ??
        draft.squad.starters[0].element;
      const vc =
        draft.squad.starters.find((p) => p.is_vice_captain)?.element ??
        draft.squad.starters.find((p) => p.element !== cap)?.element ??
        cap;

      const res = await fetch(`${API_BASE}/api/squad/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starters: draft.squad.starters.map((p) => p.element),
          bench: draft.squad.bench.map((p) => p.element),
          captain: cap,
          vice_captain: vc,
          gw: gwToEval,
          budget: draft.sellingBudget,
          active_chip: null,
          free_transfers: ftOverride,
          n_transfers: draft.nTransfers,
          enforce_constraints: enforceConstraints,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const msg =
          typeof err.detail === "string"
            ? err.detail
            : "Squad violates FPL rules.";
        setConfirmError(msg);
        return { valid: false, violations: draft.violations };
      }

      const data = await res.json();
      const updatedDraft: DraftSquadState = {
        ...draft,
        squad: data.lineup,
        hitCost: data.hit_cost ?? 0,
        violations: data.violations || [],
        confirmed: enforceConstraints ? true : draft.confirmed,
      };
      setDraftState(updatedDraft);
      setSuggestedCapCompare(data.suggested_captain || null);
      setBank(data.lineup.bank);
      return {
        valid: Boolean(data.is_valid),
        violations: data.violations || [],
        updated: updatedDraft,
      };
    } catch (err: any) {
      setConfirmError(err.message || "Evaluation failed");
      return { valid: false, violations: draft.violations };
    } finally {
      setEvalLoading(false);
    }
  };

  // Load manager squad from FPL API for a specific GW
  const fetchManagerForGw = async (
    teamId: number,
    gwToLoad: number,
    activeDraft: DraftSquadState | null = draftState,
    isSameManager = activeTeamId === teamId
  ) => {
    setManagerLoading(true);
    setErrorMsg(null);
    setConfirmError(null);
    try {
      const [mgrRes, sqRes] = await Promise.all([
        fetch(`${API_BASE}/api/manager/${teamId}?gw=${gwToLoad}`),
        fetch(`${API_BASE}/api/manager/${teamId}/squad?gw=${gwToLoad}&horizon=1`),
      ]);
      if (!mgrRes.ok || !sqRes.ok) {
        const detail = !sqRes.ok
          ? (await sqRes.json()).detail
          : (await mgrRes.json()).detail;
        throw new Error(detail || `Failed to load manager #${teamId}`);
      }
      const mgr = await mgrRes.json();
      const sq = await sqRes.json();

      setActiveTeamId(teamId);
      setManagerInfo(mgr);
      setChipStatus(sq.chip_status || mgr.chip_status || []);
      setActiveChip(sq.active_chip || null);
      setIsFutureProjection(Boolean(sq.is_future_projection));
      setPicksSourceGw(sq.picks_source_gw ?? null);
      setOfficialManagerSquad(sq.manager_lineup);
      setSellingBudget(sq.selling_budget || 100.0);
      setTransferResult(null);
      setSelectedPitchElement(null);

      // Carry forward confirmed/active draft edits across Next -> Projected GWs
      if (
        isSameManager &&
        activeDraft &&
        gwToLoad >= currentGw + 1 &&
        gwToLoad >= activeDraft.fromGw
      ) {
        await evaluateDraftOnServer(activeDraft, gwToLoad, false);
      } else {
        if (!isSameManager) {
          setDraftState(null);
          setOptimusBudget(sq.selling_budget || 100.0);
        }
        setSuggestedCapCompare(sq.suggested_captain || null);
        setBank(sq.bank);
      }
      setActiveTab("current");
      return sq;
    } catch (err: any) {
      setErrorMsg(err.message);
      return null;
    } finally {
      setManagerLoading(false);
    }
  };

  const handleLoadManager = async (teamId: number) => {
    const isSame = activeTeamId === teamId;
    const sq = await fetchManagerForGw(teamId, selectedGw, isSame ? draftState : null, isSame);
    await Promise.all([
      handleSyncLive(selectedGw),
      fetchOptimusSquads(selectedGw, sq?.selling_budget || optimusBudget),
    ]);
  };

  // Auto-reload squad, bootstrap player market, live points & Optimus 5k squads on GW change
  const handleChangeGw = async (newGw: number) => {
    setSelectedGw(newGw);
    setSelectedPitchElement(null);
    setConfirmError(null);
    if (newGw <= currentGw) {
      setPitchSubMode("overview");
    }
    await fetchBootstrapForGw(newGw);
    await Promise.all([
      handleSyncLive(newGw),
      fetchOptimusSquads(newGw, optimusBudget),
      activeTeamId
        ? fetchManagerForGw(activeTeamId, newGw, draftState, true)
        : Promise.resolve(null),
    ]);
  };

  // Helper to obtain or initialize editable DraftSquadState from official picks
  const ensureDraft = (): DraftSquadState | null => {
    if (draftState && selectedGw >= draftState.fromGw) {
      return draftState;
    }
    if (!officialManagerSquad) return null;
    const originElements = [
      ...officialManagerSquad.starters.map((p) => p.element),
      ...officialManagerSquad.bench.map((p) => p.element),
    ];
    return {
      fromGw: Math.max(selectedGw, currentGw + 1),
      squad: {
        ...officialManagerSquad,
        starters: officialManagerSquad.starters.map((p) => ({ ...p })),
        bench: officialManagerSquad.bench.map((p) => ({ ...p })),
      },
      originElements,
      sellingBudget,
      nTransfers: 0,
      hitCost: 0,
      violations: [],
      confirmed: false,
    };
  };

  // Effective Manager Squad to display (Draft if active on Next/Projected GW, else Official)
  const effectiveManagerSquad: SquadData | null = useMemo(() => {
    if (
      draftState &&
      selectedGw >= currentGw + 1 &&
      selectedGw >= draftState.fromGw
    ) {
      return draftState.squad;
    }
    return officialManagerSquad;
  }, [draftState, officialManagerSquad, selectedGw, currentGw]);

  const draftModified = Boolean(
    draftState && selectedGw >= currentGw + 1 && selectedGw >= draftState.fromGw
  );

  // Set Captain in Pick Team mode
  const handleSetCaptain = async (elementId: number) => {
    const draft = ensureDraft();
    if (!draft) return;
    const oldCap = draft.squad.starters.find((p) => p.is_captain);
    const targetWasVc = draft.squad.starters.find(
      (p) => p.element === elementId
    )?.is_vice_captain;

    const starters = draft.squad.starters.map((p) => {
      if (p.element === elementId) {
        return { ...p, is_captain: true, is_vice_captain: false, multiplier: 2 };
      }
      if (oldCap && p.element === oldCap.element) {
        return {
          ...p,
          is_captain: false,
          is_vice_captain: Boolean(targetWasVc),
          multiplier: 1,
        };
      }
      return { ...p, is_captain: false, multiplier: 1 };
    });

    const metrics = computeLocalSquadMetrics(
      starters,
      draft.squad.bench,
      draft.sellingBudget,
      null,
      optimalFitness
    );
    const nextDraft: DraftSquadState = {
      ...draft,
      squad: { ...draft.squad, starters, ...metrics },
      violations: metrics.violations,
    };
    setDraftState(nextDraft);
    await evaluateDraftOnServer(nextDraft, selectedGw, false);
  };

  // Set Vice-Captain in Pick Team mode
  const handleSetViceCaptain = async (elementId: number) => {
    const draft = ensureDraft();
    if (!draft) return;
    const starters = draft.squad.starters.map((p) => ({
      ...p,
      is_vice_captain: p.element === elementId && !p.is_captain,
    }));
    const nextDraft: DraftSquadState = {
      ...draft,
      squad: { ...draft.squad, starters },
    };
    setDraftState(nextDraft);
    await evaluateDraftOnServer(nextDraft, selectedGw, false);
  };

  // Substitute / Swap two players in Pick Team mode
  const handleSubstitute = async (aEl: number, bEl: number) => {
    const draft = ensureDraft();
    if (!draft) return;
    const starters = [...draft.squad.starters];
    const bench = [...draft.squad.bench];
    const aS = starters.findIndex((p) => p.element === aEl);
    const aB = bench.findIndex((p) => p.element === aEl);
    const bS = starters.findIndex((p) => p.element === bEl);
    const bB = bench.findIndex((p) => p.element === bEl);

    const aPlayer = aS >= 0 ? starters[aS] : bench[aB];
    const bPlayer = bS >= 0 ? starters[bS] : bench[bB];
    if (!aPlayer || !bPlayer || !canSwapPlayers(starters, bench, aPlayer, bPlayer)) {
      return;
    }

    if (aS >= 0 && bB >= 0) {
      const capLeft = aPlayer.is_captain;
      const vcLeft = aPlayer.is_vice_captain;
      starters[aS] = {
        ...bPlayer,
        role: "starter",
        is_captain: capLeft,
        is_vice_captain: vcLeft,
        multiplier: capLeft ? 2 : 1,
      };
      bench[bB] = {
        ...aPlayer,
        role: `bench${bB}`,
        is_captain: false,
        is_vice_captain: false,
        multiplier: 0,
      };
    } else if (bS >= 0 && aB >= 0) {
      const capLeft = bPlayer.is_captain;
      const vcLeft = bPlayer.is_vice_captain;
      starters[bS] = {
        ...aPlayer,
        role: "starter",
        is_captain: capLeft,
        is_vice_captain: vcLeft,
        multiplier: capLeft ? 2 : 1,
      };
      bench[aB] = {
        ...bPlayer,
        role: `bench${aB}`,
        is_captain: false,
        is_vice_captain: false,
        multiplier: 0,
      };
    } else if (aB >= 0 && bB >= 0) {
      bench[aB] = { ...bPlayer, role: `bench${aB}` };
      bench[bB] = { ...aPlayer, role: `bench${bB}` };
    }

    const metrics = computeLocalSquadMetrics(
      starters,
      bench,
      draft.sellingBudget,
      null,
      optimalFitness
    );
    const nextDraft: DraftSquadState = {
      ...draft,
      squad: { ...draft.squad, starters, bench, ...metrics },
      violations: metrics.violations,
    };
    setSelectedPitchElement(null);
    setDraftState(nextDraft);
    await evaluateDraftOnServer(nextDraft, selectedGw, false);
  };

  // Auto-Pick Optimal XI + Captaincy from the current 15 players
  const handleAutoPickXI = async () => {
    const draft = ensureDraft();
    if (!draft) return;
    const all = [...draft.squad.starters, ...draft.squad.bench].sort(
      (x, y) => y.xp - x.xp
    );
    const gks = all.filter((p) => p.position === "GK");
    const defs = all.filter((p) => p.position === "DEF");
    const mids = all.filter((p) => p.position === "MID");
    const fwds = all.filter((p) => p.position === "FWD");

    const picked: PlayerCardData[] = [
      gks[0],
      ...defs.slice(0, 3),
      ...mids.slice(0, 2),
      ...fwds.slice(0, 1),
    ].filter(Boolean);
    const pickedSet = new Set(picked.map((p) => p.element));
    const remOutfield = all
      .filter((p) => p.position !== "GK" && !pickedSet.has(p.element))
      .slice(0, 4);
    const xiRaw = [...picked, ...remOutfield];
    const xiSet = new Set(xiRaw.map((p) => p.element));
    const sortedXi = [...xiRaw].sort((x, y) => y.xp - x.xp);
    const capEl = sortedXi[0].element;
    const vcEl = sortedXi[1]?.element ?? capEl;

    const starters = xiRaw.map((p) => ({
      ...p,
      role: "starter",
      is_captain: p.element === capEl,
      is_vice_captain: p.element === vcEl,
      multiplier: p.element === capEl ? 2 : 1,
    }));
    const remBenchOutfield = all.filter(
      (p) => p.position !== "GK" && !xiSet.has(p.element)
    );
    const bench = [gks[1], ...remBenchOutfield].filter(Boolean).map((p, idx) => ({
      ...p,
      role: `bench${idx}`,
      is_captain: false,
      is_vice_captain: false,
      multiplier: 0,
    }));

    const metrics = computeLocalSquadMetrics(
      starters,
      bench,
      draft.sellingBudget,
      null,
      optimalFitness
    );
    const nextDraft: DraftSquadState = {
      ...draft,
      squad: { ...draft.squad, starters, bench, ...metrics },
      violations: metrics.violations,
    };
    setSelectedPitchElement(null);
    setDraftState(nextDraft);
    await evaluateDraftOnServer(nextDraft, selectedGw, false);
  };

  // Manual Transfer Out -> Transfer In Preview (allows illegal bank/club caps for exploration!)
  const handlePreviewTransferIn = async (
    outPlayer: PlayerCardData,
    inPlayer: PoolPlayerItem
  ) => {
    const draft = ensureDraft();
    if (!draft) return;

    const newCard: PlayerCardData = {
      element: inPlayer.element,
      name: inPlayer.name,
      position: inPlayer.position,
      team_id: inPlayer.team_id,
      team_short: inPlayer.team_short,
      price: inPlayer.price,
      xp_base: inPlayer.xp_base ?? inPlayer.xp,
      p_defcon: inPlayer.p_defcon ?? 0,
      xp: inPlayer.xp ?? 0,
      role: outPlayer.role,
      is_captain: outPlayer.is_captain,
      is_vice_captain: outPlayer.is_vice_captain,
      multiplier: outPlayer.multiplier ?? 1,
      fdr: inPlayer.fdr,
      was_home: inPlayer.was_home,
      opponent_short: inPlayer.opponent_short,
      status: inPlayer.status,
      news: inPlayer.news,
      archetype: inPlayer.archetype,
    };

    const starters = draft.squad.starters.map((p) =>
      p.element === outPlayer.element ? newCard : p
    );
    const bench = draft.squad.bench.map((p) =>
      p.element === outPlayer.element ? newCard : p
    );

    const originSet = new Set(draft.originElements);
    const newAll = [...starters, ...bench];
    const nTransfers = newAll.filter((p) => !originSet.has(p.element)).length;
    const hitCost = Math.max(0, nTransfers - freeTransfers) * 4;

    const metrics = computeLocalSquadMetrics(
      starters,
      bench,
      draft.sellingBudget,
      null,
      optimalFitness
    );
    const nextDraft: DraftSquadState = {
      ...draft,
      fromGw: Math.min(draft.fromGw, selectedGw),
      squad: { ...draft.squad, starters, bench, ...metrics },
      nTransfers,
      hitCost,
      violations: metrics.violations,
      confirmed: false,
    };

    setSelectedPitchElement(null);
    setConfirmError(null);
    setDraftState(nextDraft);
    await evaluateDraftOnServer(nextDraft, selectedGw, false);
  };

  // Reset planned transfers & Pick Team changes back to official FPL picks
  const handleResetDraft = async () => {
    setDraftState(null);
    setSelectedPitchElement(null);
    setConfirmError(null);
    if (activeTeamId) {
      await fetchManagerForGw(activeTeamId, selectedGw, null, true);
    }
  };

  // Run AI Transfer Optimizer on the displayed/draft squad
  const handleOptimizeTransfers = async () => {
    const activeSquad =
      activeTab === "current" && effectiveManagerSquad
        ? effectiveManagerSquad
        : optimusData?.freehit.squad;
    if (!activeSquad) {
      setErrorMsg("Load a manager squad or wait for Optimus Freehit to finish.");
      return;
    }
    const elements = [
      ...activeSquad.starters.map((p) => p.element),
      ...activeSquad.bench.map((p) => p.element),
    ];
    setTransferLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/optimize/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          squad_elements: elements,
          bank: Math.max(0, activeSquad.bank),
          free_transfers: freeTransfers,
          include_hits: includeHits,
          max_extra_hits: 2,
          horizon: 1,
          gw: selectedGw,
          seed: 2026,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Transfer optimization failed");
      }
      const data: TransferResultPayload = await res.json();
      setTransferResult(data);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setTransferLoading(false);
    }
  };

  // Compute valid Pick Team swap targets whenever a player is selected
  const validSwapElements = useMemo(() => {
    if (
      activeTab !== "current" ||
      pitchSubMode !== "pick_team" ||
      selectedPitchElement === null ||
      !effectiveManagerSquad
    ) {
      return undefined;
    }
    const all = [
      ...effectiveManagerSquad.starters,
      ...effectiveManagerSquad.bench,
    ];
    const src = all.find((p) => p.element === selectedPitchElement);
    if (!src) return undefined;
    const valid = new Set<number>();
    for (const target of all) {
      if (
        canSwapPlayers(
          effectiveManagerSquad.starters,
          effectiveManagerSquad.bench,
          src,
          target
        )
      ) {
        valid.add(target.element);
      }
    }
    return valid;
  }, [activeTab, pitchSubMode, selectedPitchElement, effectiveManagerSquad]);

  const transferredInElements = useMemo(() => {
    if (!draftState || selectedGw < currentGw + 1) return undefined;
    const originSet = new Set(draftState.originElements);
    const set = new Set<number>();
    for (const p of [...draftState.squad.starters, ...draftState.squad.bench]) {
      if (!originSet.has(p.element)) set.add(p.element);
    }
    return set;
  }, [draftState, selectedGw, currentGw]);

  // Handle clicking a player on Pitch
  const handlePitchPlayerClick = (player: PlayerCardData) => {
    setSelectedPlayer(player);
    if (activeTab !== "current" || !isNextOrProjected) return;

    if (pitchSubMode === "pick_team") {
      if (selectedPitchElement === null) {
        setSelectedPitchElement(player.element);
      } else if (selectedPitchElement === player.element) {
        setSelectedPitchElement(null);
      } else if (validSwapElements?.has(player.element)) {
        handleSubstitute(selectedPitchElement, player.element);
      } else {
        setSelectedPitchElement(player.element);
      }
    } else if (pitchSubMode === "transfers") {
      setSelectedPitchElement((prev) =>
        prev === player.element ? null : player.element
      );
    }
  };

  // Determine active squad & view metadata for Pitch
  const displayedSquad: SquadData | null =
    activeTab === "current"
      ? effectiveManagerSquad
      : activeTab === "freehit"
      ? optimusData?.freehit.squad ?? null
      : optimusData?.wildcard.squad ?? null;

  const activeConvergence: ConvergencePoint[] =
    activeTab === "wildcard"
      ? optimusData?.wildcard.convergence ?? []
      : optimusData?.freehit.convergence ?? [];

  const selectedOutCard: PlayerCardData | null = useMemo(() => {
    if (pitchSubMode !== "transfers" || selectedPitchElement === null || !effectiveManagerSquad) {
      return null;
    }
    return (
      [...effectiveManagerSquad.starters, ...effectiveManagerSquad.bench].find(
        (p) => p.element === selectedPitchElement
      ) || null
    );
  }, [pitchSubMode, selectedPitchElement, effectiveManagerSquad]);

  const viewLabel =
    activeTab === "freehit" && optimusData
      ? `Optimus Freehit: Optimal GW${optimusData.freehit.start_gw} Squad (Simulated Annealing · 5,000 iterations)`
      : activeTab === "wildcard" && optimusData
      ? `Optimus Wildcard: Optimal GW${optimusData.wildcard.start_gw}-GW${optimusData.wildcard.end_gw} (${optimusData.wildcard.n_gws} GWs) Squad (Simulated Annealing · 5,000 iterations)`
      : undefined;

  const showBootstrapLoader =
    sourceMode === "loading..." && !displayedSquad && !errorMsg;

  return (
    <div
      className={`${
        showBootstrapLoader ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]"
      } bg-ink-950 text-mist-50 flex flex-col`}
    >
      {showBootstrapLoader && (
        <OptimusLoader
          mode="fullscreen"
          label="Initializing FPL Optimus"
          sublabel="Loading player projections, GMM archetypes & 5,000-iteration SA solver"
        />
      )}
      <AppHeader season={season} sourceMode={sourceMode} />

      <main className="w-full max-w-7xl mx-auto px-3 sm:px-6 py-5 flex flex-col gap-4 flex-1">
        {/* Error Alert */}
        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl bg-danger-950/90 border border-danger-400/60 px-4 py-2.5 text-xs text-mist-50 flex justify-between items-center gap-3"
          >
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label="Dismiss error"
              className="inline-flex items-center justify-center rounded-md p-1 text-danger-400 hover:bg-ink-900/60 hover:text-mist-50 transition cursor-pointer"
            >
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Manager ID Lookup Bar + 8-Chip Status Strip */}
        <ManagerBar
          onLoadManager={handleLoadManager}
          managerInfo={managerInfo}
          chipStatus={chipStatus}
          activeChip={activeChip}
          loading={managerLoading}
          currentGw={currentGw}
          selectedGw={selectedGw}
          onChangeGw={handleChangeGw}
          onRefreshLive={() => handleSyncLive(selectedGw)}
        />

        {/* Main Split Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left 7 Columns: Squad Mode Tabs + FPL Sub-Toolbar + Pitch */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <Panel variant="default" className="p-3 flex flex-col gap-3">
              {/* Primary Tabs: Manager Squad | Optimus Freehit | Optimus Wildcard */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    disabled={!effectiveManagerSquad}
                    onClick={() => {
                      setActiveTab("current");
                      setSelectedPitchElement(null);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed ${
                      activeTab === "current"
                        ? "bg-cobalt-500 text-mist-50"
                        : "bg-ink-800 text-mist-300 hover:bg-ink-700 hover:text-mist-50 disabled:opacity-40"
                    }`}
                  >
                    <UsersThree size={15} weight="bold" aria-hidden="true" />
                    <span>Current Manager Squad</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("freehit");
                      setPitchSubMode("overview");
                      setSelectedPitchElement(null);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition active:scale-[0.98] cursor-pointer ${
                      activeTab === "freehit"
                        ? "bg-crimson-500 text-mist-50"
                        : "bg-ink-800 text-mist-300 hover:bg-ink-700 hover:text-mist-50"
                    }`}
                  >
                    <Lightning size={15} weight="fill" aria-hidden="true" />
                    <span>Optimus Freehit (Next GW · 5k SA)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("wildcard");
                      setPitchSubMode("overview");
                      setSelectedPitchElement(null);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition active:scale-[0.98] cursor-pointer ${
                      activeTab === "wildcard"
                        ? "bg-cobalt-500 text-mist-50"
                        : "bg-ink-800 text-mist-300 hover:bg-ink-700 hover:text-mist-50"
                    }`}
                  >
                    <Star size={15} weight="fill" aria-hidden="true" />
                    <span>Optimus Wildcard (Next 5 GWs · 5k SA)</span>
                  </button>
                </div>
              </div>

              {/* Secondary Bar: FPL Pick Team & Transfers (Next -> Projected GW) OR Optimus Budget Rebuild */}
              {activeTab === "current" && effectiveManagerSquad && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-ink-700 text-xs">
                  {isNextOrProjected ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPitchSubMode("overview");
                            setSelectedPitchElement(null);
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition active:scale-[0.98] cursor-pointer ${
                            pitchSubMode === "overview"
                              ? "bg-cobalt-500 text-mist-50"
                              : "bg-ink-800 text-mist-300 hover:bg-ink-700 hover:text-mist-50"
                          }`}
                        >
                          <ShieldCheck size={14} weight="bold" aria-hidden="true" />
                          <span>Projected Overview</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPitchSubMode("pick_team");
                            setSelectedPitchElement(null);
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition active:scale-[0.98] cursor-pointer ${
                            pitchSubMode === "pick_team"
                              ? "bg-cobalt-500 text-mist-50"
                              : "bg-cobalt-950 border border-cobalt-500/50 text-cobalt-400 hover:border-cobalt-400"
                          }`}
                        >
                          <SlidersHorizontal size={14} weight="bold" aria-hidden="true" />
                          <span>Pick Team</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPitchSubMode("transfers");
                            setSelectedPitchElement(null);
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition active:scale-[0.98] cursor-pointer ${
                            pitchSubMode === "transfers"
                              ? "bg-crimson-500 text-mist-50"
                              : "bg-crimson-950 border border-crimson-500/50 text-crimson-400 hover:border-crimson-400"
                          }`}
                        >
                          <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />
                          <span>Transfers</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={evalLoading}
                          onClick={() => {
                            const d = ensureDraft();
                            if (d) evaluateDraftOnServer(d, selectedGw, false);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md bg-ink-800 hover:bg-ink-700 border border-ink-700 hover:border-cobalt-400 px-2.5 py-1.5 font-semibold text-spark-400 disabled:opacity-50 transition active:scale-[0.98] cursor-pointer"
                        >
                          <ArrowClockwise
                            size={14}
                            weight="bold"
                            className={evalLoading ? "animate-spin" : ""}
                            aria-hidden="true"
                          />
                          <span>
                            {evalLoading
                              ? "Refreshing..."
                              : "Refresh Projected Pts & Rating"}
                          </span>
                        </button>
                        {draftModified && (
                          <button
                            type="button"
                            onClick={handleResetDraft}
                            className="rounded-md bg-danger-950 hover:bg-danger-400/20 border border-danger-400/50 px-2.5 py-1.5 font-semibold text-danger-400 transition active:scale-[0.98] cursor-pointer"
                          >
                            Reset Draft
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 w-full text-mist-300">
                      <span>
                        Viewing finished/live{" "}
                        <strong className="text-mist-50">
                          GW{selectedGw} Points
                        </strong>
                        . Switch Gameweek to{" "}
                        <strong className="text-spark-400">
                          GW{currentGw + 1} (Next)
                        </strong>{" "}
                        or later to unlock{" "}
                        <strong className="text-mist-50">Pick Team</strong> &amp;{" "}
                        <strong className="text-mist-50">Transfers</strong>.
                      </span>
                      <button
                        type="button"
                        onClick={() => handleChangeGw(Math.min(38, currentGw + 1))}
                        className="inline-flex items-center gap-1.5 rounded-md bg-crimson-500 hover:bg-crimson-400 text-mist-50 font-bold px-3 py-1.5 text-[11px] shrink-0 transition active:scale-[0.98] cursor-pointer"
                      >
                        <span>Plan GW{Math.min(38, currentGw + 1)}</span>
                        <ArrowRight size={13} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab !== "current" && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-ink-700 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor="optimus-budget-input"
                      className="text-mist-300 font-medium"
                    >
                      Optimus Budget (£m):
                    </label>
                    <input
                      id="optimus-budget-input"
                      type="number"
                      step="0.5"
                      min="75"
                      max="120"
                      value={optimusBudget}
                      onChange={(e) =>
                        setOptimusBudget(parseFloat(e.target.value) || 100)
                      }
                      className="w-24 h-8 rounded-md bg-ink-950 border border-ink-700 px-2.5 font-mono text-mist-50 focus:border-cobalt-400 focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      disabled={optimusLoading}
                      onClick={() =>
                        fetchOptimusSquads(selectedGw, optimusBudget, true)
                      }
                      className="rounded-md bg-crimson-500 hover:bg-crimson-400 disabled:opacity-50 text-mist-50 font-bold px-3 py-1.5 transition active:scale-[0.98] cursor-pointer"
                    >
                      {optimusLoading
                        ? "Solving 5,000 SA iters..."
                        : "Rebuild Freehit & Wildcard (5k SA)"}
                    </button>
                  </div>
                  <span className="text-[11px] font-mono text-mist-300">
                    Always 5,000 Simulated Annealing iterations
                  </span>
                </div>
              )}
            </Panel>

            {/* Tactical Pitch Visualizer (with Optimus loading animation when building/syncing squads) */}
            {optimusLoading || managerLoading || (!displayedSquad && !errorMsg) ? (
              <OptimusLoader
                mode="panel"
                label={
                  managerLoading
                    ? "Loading Manager Squad"
                    : "Solving Optimal Squad"
                }
                sublabel={
                  managerLoading
                    ? "Syncing official FPL picks, bank & 8-chip history"
                    : "Running 5,000 Simulated Annealing iterations"
                }
              />
            ) : (
              <Pitch
                squad={displayedSquad}
                viewLabel={viewLabel}
                liveMap={liveMap}
                isFutureGw={
                  activeTab !== "current" || isFutureProjection || isNextOrProjected
                }
                selectedGw={
                  activeTab === "current"
                    ? selectedGw
                    : optimusData?.anchor_gw ?? selectedGw
                }
                picksSourceGw={picksSourceGw}
                suggestedCaptainCompare={
                  activeTab === "current" ? suggestedCapCompare : null
                }
                interactiveMode={
                  activeTab === "current" && isNextOrProjected
                    ? pitchSubMode === "overview"
                      ? "view"
                      : pitchSubMode
                    : "view"
                }
                selectedElement={selectedPitchElement}
                validSwapElements={validSwapElements}
                transferredInElements={transferredInElements}
                violations={
                  activeTab === "current" && draftModified
                    ? draftState?.violations || []
                    : []
                }
                hitCost={
                  activeTab === "current" && draftModified
                    ? draftState?.hitCost || 0
                    : 0
                }
                evalLoading={evalLoading}
                draftModified={draftModified}
                onSelectPlayer={handlePitchPlayerClick}
                onSetCaptain={handleSetCaptain}
                onSetViceCaptain={handleSetViceCaptain}
                onAutoPickXI={handleAutoPickXI}
                onRefreshEvaluation={() => {
                  const d = ensureDraft();
                  if (d) evaluateDraftOnServer(d, selectedGw, false);
                }}
                onSavePickTeam={async () => {
                  const d = ensureDraft();
                  if (!d) return;
                  const check = await evaluateDraftOnServer(d, selectedGw, true);
                  if (check.valid) {
                    setPitchSubMode("overview");
                    setSelectedPitchElement(null);
                  }
                }}
                onResetDraft={handleResetDraft}
              />
            )}
          </div>

          {/* Right 5 Columns: Manual Player Market (when Transfers active) + AI Transfer Decision Studio + Player Inspector */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {activeTab === "current" &&
              isNextOrProjected &&
              pitchSubMode === "transfers" &&
              effectiveManagerSquad && (
                <ManualTransferPanel
                  selectedGw={selectedGw}
                  currentSquadPlayers={[
                    ...effectiveManagerSquad.starters,
                    ...effectiveManagerSquad.bench,
                  ]}
                  playerMarket={fullPlayersPool}
                  selectedOut={selectedOutCard}
                  freeTransfers={freeTransfers}
                  onChangeFreeTransfers={(ft) => {
                    setFreeTransfers(ft);
                    if (draftState) {
                      const hitCost = Math.max(0, draftState.nTransfers - ft) * 4;
                      setDraftState({ ...draftState, hitCost });
                    }
                  }}
                  bank={effectiveManagerSquad.bank}
                  nTransfers={draftState?.nTransfers ?? 0}
                  hitCost={draftState?.hitCost ?? 0}
                  projectedPoints={effectiveManagerSquad.projected_points ?? 0}
                  gwRatingPct={effectiveManagerSquad.gw_rating_pct ?? 0}
                  violations={draftState?.violations ?? []}
                  hasPendingChanges={draftModified}
                  evalLoading={evalLoading}
                  confirmError={confirmError}
                  onClearSelectedOut={() => setSelectedPitchElement(null)}
                  onSelectTransferIn={handlePreviewTransferIn}
                  onRefreshProjection={() => {
                    const d = ensureDraft();
                    if (d) evaluateDraftOnServer(d, selectedGw, false);
                  }}
                  onConfirmTransfers={async () => {
                    const d = ensureDraft();
                    if (!d) return;
                    const res = await evaluateDraftOnServer(d, selectedGw, true);
                    if (res.valid) {
                      setPitchSubMode("overview");
                      setSelectedPitchElement(null);
                    }
                  }}
                  onResetTransfers={handleResetDraft}
                  onExitTransfers={() => {
                    setPitchSubMode("overview");
                    setSelectedPitchElement(null);
                  }}
                />
              )}

            <TransferModal
              freeTransfers={freeTransfers}
              onChangeFreeTransfers={setFreeTransfers}
              bank={Math.max(0, bank)}
              onChangeBank={setBank}
              includeHits={includeHits}
              onToggleHits={setIncludeHits}
              onRunOptimize={handleOptimizeTransfers}
              loading={transferLoading}
              result={transferResult}
              onApplyPlan={async (newSquad) => {
                const targetGw = isNextOrProjected
                  ? selectedGw
                  : Math.min(38, currentGw + 1);
                if (selectedGw !== targetGw) {
                  setSelectedGw(targetGw);
                  await fetchBootstrapForGw(targetGw);
                }
                const originEls = officialManagerSquad
                  ? [
                      ...officialManagerSquad.starters.map((p) => p.element),
                      ...officialManagerSquad.bench.map((p) => p.element),
                    ]
                  : [...newSquad.starters.map((p) => p.element), ...newSquad.bench.map((p) => p.element)];
                const originSet = new Set(originEls);
                const allNew = [...newSquad.starters, ...newSquad.bench];
                const nTransfers = allNew.filter((p) => !originSet.has(p.element)).length;
                const nextDraft: DraftSquadState = {
                  fromGw: targetGw,
                  squad: newSquad,
                  originElements: originEls,
                  sellingBudget: sellingBudget || 100.0,
                  nTransfers,
                  hitCost: Math.max(0, nTransfers - freeTransfers) * 4,
                  violations: [],
                  confirmed: true,
                };
                setDraftState(nextDraft);
                setActiveTab("current");
                setPitchSubMode("overview");
                await evaluateDraftOnServer(nextDraft, targetGw, false);
              }}
            />

            {/* Selected Player Telemetry & GMM Posterior Card */}
            <Panel variant="default" className="p-4 text-xs flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 border-b border-ink-700 pb-2">
                <div className="flex items-center gap-2 font-bold text-sm text-mist-50">
                  <ChartBar
                    size={16}
                    weight="bold"
                    className="text-cobalt-400"
                    aria-hidden="true"
                  />
                  <span>Player Telemetry &amp; GMM Archetype Inspector</span>
                </div>
                {selectedPlayer && (
                  <Badge tone="neutral">
                    {selectedPlayer.position} · {selectedPlayer.team_short}
                  </Badge>
                )}
              </div>

              {!selectedPlayer ? (
                <div className="rounded-md bg-ink-950/80 border border-ink-700/80 px-3 py-4 text-mist-300 leading-relaxed">
                  Click any player on the pitch to view their decoupled{" "}
                  <code className="font-mono text-mist-50">xP_base</code>, calibrated{" "}
                  <code className="font-mono text-spark-400">P(DefCon Hit)</code>, and
                  soft Gaussian Mixture archetype probabilities.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 font-mono">
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">Player</div>
                    <strong className="text-mist-50 font-bold">
                      {selectedPlayer.name}
                    </strong>{" "}
                    <span className="text-mist-300">
                      ({selectedPlayer.position} · {selectedPlayer.team_short})
                    </span>
                  </div>
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">Price</div>
                    <strong className="text-mist-50 font-bold tabular-nums">
                      £{selectedPlayer.price.toFixed(1)}m
                    </strong>
                  </div>
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">xP_base</div>
                    <strong className="text-spark-400 font-bold tabular-nums">
                      {selectedPlayer.xp_base.toFixed(2)}
                    </strong>
                  </div>
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">
                      P(DefCon Hit)
                    </div>
                    <strong className="text-spark-400 font-bold tabular-nums">
                      {(selectedPlayer.p_defcon * 100).toFixed(1)}% (+
                      {(selectedPlayer.p_defcon * 2).toFixed(2)} xP)
                    </strong>
                  </div>
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">
                      Combined 1x xP
                    </div>
                    <strong className="text-crimson-400 font-bold tabular-nums">
                      {selectedPlayer.xp.toFixed(2)}
                    </strong>
                  </div>
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">
                      GMM Archetype
                    </div>
                    <strong className="text-gold-400 font-bold">
                      {selectedPlayer.archetype || "N/A"}
                    </strong>
                  </div>
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">
                      P(DefCon Anchor)
                    </div>
                    <span className="text-mist-50 font-semibold tabular-nums">
                      {((selectedPlayer.p_defcon_anchor ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="rounded-md bg-ink-950 border border-ink-700 px-2.5 py-2">
                    <div className="text-[11px] font-sans text-mist-300">
                      P(Attacking Outlet)
                    </div>
                    <span className="text-mist-50 font-semibold tabular-nums">
                      {((selectedPlayer.p_attacking_outlet ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>

        {/* Bottom Analytics & Convergence Drawer */}
        <Charts
          liveConvergence={activeConvergence}
          benchmarks={benchmarks}
          playersPool={gmmPlayersPool}
        />
      </main>
    </div>
  );
}
