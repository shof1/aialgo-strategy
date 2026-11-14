import type { AssetSpec, StrategyParams } from "../core/types";
import type { RunResult } from "./engine";

export interface BacktestSummary {
  start: string;
  end: string;
  generatedAt: string;
  days: number;
  asset: AssetSpec;
  params: StrategyParams;
  netYen: number;
  revenueYen: number;
  costYen: number;
  baselineNetYen: number;
  buyFills: number;
  sellFills: number;
  ordersPlaced: number;
  daysWithTrades: number;
  socViolations: number;
  dischargedMwh: number;
  chargedMwh: number;
}

export function summarize(
  runs: RunResult[],
  meta: { start: string; end: string; asset: AssetSpec; params: StrategyParams },
): BacktestSummary {
  const sum = (f: (r: RunResult) => number) => runs.reduce((a, r) => a + f(r), 0);
  return {
    ...meta,
    generatedAt: new Date().toISOString(),
    days: runs.length,
    netYen: sum((r) => r.pnl.netYen),
    revenueYen: sum((r) => r.pnl.revenueYen),
    costYen: sum((r) => r.pnl.costYen),
    baselineNetYen: sum((r) => r.baseline.netYen),
    buyFills: sum((r) => r.stats.buyFills),
    sellFills: sum((r) => r.stats.sellFills),
    ordersPlaced: sum((r) => r.stats.ordersPlaced),
    daysWithTrades: runs.filter((r) => r.fills.length > 0).length,
    socViolations: runs.filter((r) => !r.stats.socOk).length,
    dischargedMwh: sum((r) => r.fills.filter((f) => f.side === "sell").reduce((a, f) => a + f.mwh, 0)),
    chargedMwh: sum((r) => r.fills.filter((f) => f.side === "buy").reduce((a, f) => a + f.mwh, 0)),
  };
}
