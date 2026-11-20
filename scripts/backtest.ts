/**
 * 過去 N 日のバックテスト。結果を data/backtest/latest.json に保存。
 * 使い方: npm run backtest -- [終了日コード=昨日] [日数=30]
 * 例:     npm run backtest -- 20261113 30
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { type FillModel, type RunResult } from "../src/lib/backtest/engine";
import { simulatePeriod } from "../src/lib/backtest/period";
import { addDays, toDateCode } from "../src/lib/core/time";
import { DEFAULT_ASSET, DEFAULT_PARAMS, FIXED_PARAMS } from "../src/lib/core/types";
import { parseIntradayCsv, parseSpotCsv } from "../src/lib/data/jepx";
import { summarize } from "../src/lib/backtest/summary";

async function load(kind: "spot" | "intraday", years: number[]) {
  let text = "";
  for (const y of years) {
    const f = path.join(process.cwd(), `data/jepx/${kind}_${y}.csv`);
    if (!existsSync(f)) throw new Error(`${f} がありません。先に npm run fetch:jepx -- ${y} を実行してください`);
    const t = await readFile(f, "utf8");
    text += text ? t.split(/\r?\n/).slice(1).join("\n") + "\n" : t + "\n";
  }
  return text;
}

async function main() {
  const end = process.argv[2] ?? addDays(toDateCode(new Date()), -1);
  const days = Number(process.argv[3] ?? 30);
  const start = addDays(end, -(days - 1));
  const years = [...new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))])];
  const spot = parseSpotCsv(await load("spot", years));
  const intraday = parseIntradayCsv(await load("intraday", years));

  const asset = DEFAULT_ASSET;
  const params = DEFAULT_PARAMS;
  const data = { spot, intraday };
  const simulate = (fillModel: FillModel): RunResult[] =>
    simulatePeriod(data, start, end, asset, params, fillModel, fillModel === "avg" ? console.warn : () => {});
  const runs = simulate("avg");
  const optimistic = summarize(simulate("touch"), { start, end, asset, params });
  // 比較: v0.2 の固定しきい値（買 < 1 円 / 売 > 30・40 円）
  const fixedRuns = simulatePeriod(data, start, end, asset, FIXED_PARAMS, "avg");
  const fixed = summarize(fixedRuns, { start, end, asset, params: FIXED_PARAMS });
  const fixedOptimistic = summarize(simulatePeriod(data, start, end, asset, FIXED_PARAMS, "touch"), { start, end, asset, params: FIXED_PARAMS });
  const summary = {
    ...summarize(runs, { start, end, asset, params }),
    fillModel: "avg",
    optimistic,
    fixed: { netYen: fixed.netYen, optimisticNetYen: fixedOptimistic.netYen, buyFills: fixed.buyFills, sellFills: fixed.sellFills },
  };
  await mkdir(path.join(process.cwd(), "data/backtest"), { recursive: true });
  const out = path.join(process.cwd(), "data/backtest/latest.json");
  await writeFile(out, JSON.stringify({ summary, runs }, null, 1));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`saved ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
