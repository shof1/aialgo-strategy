/**
 * スポット連動しきい値のオフセットを選ぶ（ウォークフォワード）。
 * 学習期間で在庫補正後の純損益（保守的な約定判定）が最大のオフセットを選び、直後の検証期間で評価する。
 * 検証期間の結果は選定に使わない（後知恵で選んだ値を成績として報告しないため）。
 *
 * 使い方: npm run sweep -- [検証終了日=20261113] [検証日数=30] [学習日数=60]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { addDays } from "../src/lib/core/time";
import { DEFAULT_ASSET, DEFAULT_PARAMS, FIXED_PARAMS, type StrategyParams } from "../src/lib/core/types";
import { parseIntradayCsv, parseSpotCsv } from "../src/lib/data/jepx";
import { inventoryAdjustedNet, simulatePeriod, type MarketData } from "../src/lib/backtest/period";
import type { FillModel, RunResult } from "../src/lib/backtest/engine";

const BUY = [-8, -6, -5, -4, -3, -2, -1, 0, 1, 2];
const SELL = [-3, -2, -1, 0, 1, 2, 3, 4, 6];
const SPREAD = [0, 2, 4];
const CATCHUP = [0, 2, 4];

const net = (runs: RunResult[]) => runs.reduce((a, r) => a + r.pnl.netYen, 0);
const base = (runs: RunResult[]) => runs.reduce((a, r) => a + r.baseline.netYen, 0);
const fills = (runs: RunResult[]) => runs.reduce((a, r) => a + r.fills.length, 0);

async function load(): Promise<MarketData> {
  const f = (k: string) => readFile(path.join(process.cwd(), `data/jepx/${k}_2026.csv`), "utf8");
  return { spot: parseSpotCsv(await f("spot")), intraday: parseIntradayCsv(await f("intraday")) };
}

function evaluate(data: MarketData, start: string, end: string, p: StrategyParams, m: FillModel) {
  const runs = simulatePeriod(data, start, end, DEFAULT_ASSET, p, m);
  return { netYen: net(runs), adjNetYen: inventoryAdjustedNet(runs, data, DEFAULT_ASSET), baselineYen: base(runs), fills: fills(runs), days: runs.length };
}

async function main() {
  const end = process.argv[2] ?? "20261113";
  const testDays = Number(process.argv[3] ?? 30);
  const trainDays = Number(process.argv[4] ?? 60);
  const testStart = addDays(end, -(testDays - 1));
  const trainEnd = addDays(testStart, -1);
  const trainStart = addDays(trainEnd, -(trainDays - 1));
  const data = await load();

  const grid: { p: StrategyParams; train: number }[] = [];
  for (const buyOffsetYen of BUY)
    for (const sellOffsetYen of SELL)
      for (const minSpreadYen of SPREAD)
        for (const catchupYen of CATCHUP) {
          const p = { ...DEFAULT_PARAMS, buyOffsetYen, sellOffsetYen, minSpreadYen, catchupYen };
          // 選定は在庫補正後の損益で行う（期首の在庫を売っただけの利益で選ばないため）
          grid.push({ p, train: evaluate(data, trainStart, trainEnd, p, "avg").adjNetYen });
        }
  grid.sort((a, b) => b.train - a.train);
  const best = grid[0].p;

  const rows = {
    fixed: FIXED_PARAMS,
    default: DEFAULT_PARAMS,
    selected: best,
  };
  const report: Record<string, unknown> = {
    train: { start: trainStart, end: trainEnd },
    test: { start: testStart, end },
    top5Train: grid.slice(0, 5).map((g) => ({
      buyOffsetYen: g.p.buyOffsetYen, sellOffsetYen: g.p.sellOffsetYen, minSpreadYen: g.p.minSpreadYen, catchupYen: g.p.catchupYen, trainAdjNetYen: Math.round(g.train),
    })),
  };
  for (const [name, p] of Object.entries(rows)) {
    report[name] = {
      params: { thresholdMode: p.thresholdMode, buyOffsetYen: p.buyOffsetYen, sellOffsetYen: p.sellOffsetYen, minSpreadYen: p.minSpreadYen, catchupYen: p.catchupYen },
      train: evaluate(data, trainStart, trainEnd, p, "avg"),
      testAvg: evaluate(data, testStart, end, p, "avg"),
      testTouch: evaluate(data, testStart, end, p, "touch"),
    };
  }
  await mkdir("data/backtest", { recursive: true });
  await writeFile("data/backtest/sweep.json", JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
