/**
 * TypeScript contract for exported FPL-Optimus workflow data.
 * Generated alongside scripts/export_workflow_data.py and consumed by /workflow components.
 */

export interface RegressionRow {
  model: string;
  subset: string;
  rmse: number;
  mae: number;
  r2: number;
}

export interface PerGwRmsePoint {
  gw: number;
  hgb: number;
  ridge: number;
  rolling3: number;
}

export interface CalibrationBin {
  bin: number;
  meanPred: number;
  meanActual: number;
  count: number;
}

export interface DefConReliabilityBin {
  bin: number;
  meanProb: number;
  empiricalRate: number;
  count: number;
}

export interface GmmSummaryRow {
  position: "GK" | "DEF" | "MID" | "FWD";
  k: number;
  archetypes: string[];
  bic: Record<string, number>;
}

export interface GmmPlayerPoint {
  element: number;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  teamShort?: string;
  cost: number;
  minutes: number;
  archetype: string;
  confidence: number;
  pDefconAnchor: number;
  pAttackingOutlet: number;
  xgPer90: number;
  xaPer90: number;
  cbitPer90: number;
  cbirtPer90: number;
  defconHitRate: number;
  totalPoints: number;
}

export interface OptimizerSummaryRow {
  agent: string;
  meanFitness: number;
  stdFitness: number;
  bestFitness: number;
  worstFitness: number;
  meanRuntimeS: number;
  meanEvaluations: number;
}

export interface OptimizerRunDot {
  agent: string;
  seed: number;
  fitness: number;
  evaluations: number;
  runtimeS: number;
  worseAccepted?: number;
  restarts?: number;
}

export interface SaTracePoint {
  step: number;
  iter: number;
  temperature: number;
  current: number;
  best: number;
}

export interface BacktestSummaryRow {
  agent: string;
  totalPoints: number;
  meanGwPoints: number;
  transfers: number;
  bestGw: number;
}

export interface BacktestGwPoint {
  gw: number;
  sa: number;
  hc: number;
  random: number;
  greedy: number;
  saGwPts: number;
  hcGwPts: number;
  randomGwPts: number;
  greedyGwPts: number;
  saCaptain: string;
}

export interface WorkflowDataset {
  meta: {
    seed: number;
    testSeason: string;
    totalRecords: number;
    engineeredColumns: number;
    oosFixtures: number;
    timingsS: {
      data: number;
      ml: number;
      gmm: number;
      benchmark: number;
      backtest: number;
    };
  };
  ml: {
    regression: RegressionRow[];
    defcon: {
      auc: number;
      brier: number;
      baseRate: number;
      n: number;
    };
    perGwRmse: PerGwRmsePoint[];
    calibration: {
      hgb: CalibrationBin[];
      ridge: CalibrationBin[];
      rolling3: CalibrationBin[];
    };
    defconReliability: DefConReliabilityBin[];
  };
  gmm: {
    summary: GmmSummaryRow[];
    players: GmmPlayerPoint[];
    spotlights: GmmPlayerPoint[];
  };
  optimizer: {
    gameweek: number;
    runs: number;
    evalBudget: number;
    summary: OptimizerSummaryRow[];
    runsBySeed: OptimizerRunDot[];
    convergenceEvalStep: number;
    convergenceMeanBest: Record<string, number[]>;
    saTrace: SaTracePoint[];
  };
  backtest: {
    summary: BacktestSummaryRow[];
    trajectory: BacktestGwPoint[];
  };
}
