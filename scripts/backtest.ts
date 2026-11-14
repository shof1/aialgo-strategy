/**
 * 過去 N 日のバックテスト。結果を data/backtest/latest.json に保存。
 * 使い方: npm run backtest -- [終了日コード=昨日] [日数=30]
 * 例:     npm run backtest -- 20261113 30
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { runDay, type FillModel, type RunResult } from "../src/lib/backtest/engine";
import { addDays, toDateCode } from "../src/lib/core/time";
import { DEFAULT_ASSET, DEFAULT_PARAMS } from "../src/lib/core/types";
import { isCompleteSpot, parseIntradayCsv, parseSpotCsv } from "../src/lib/data/jepx";
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
  const simulate = (fillModel: FillModel) => {
    let soc = asset.capacityMwh * 0.5; // 初日の開始 SOC は 50% と仮定し、以降は前日終了 SOC を引継ぐ
    const runs: RunResult[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const s = spot.get(d);
      const bars = intraday.get(d) ?? [];
      if (!isCompleteSpot(s)) {
        if (fillModel === "avg") console.warn(`skip ${d}: スポットデータ不足`);
        continue;
      }
      if (bars.length < 48 && fillModel === "avg") console.warn(`${d}: 時間前データ ${bars.length}/48 コマ`);
      const r = runDay({ dateCode: d, spotYen: s, intraday: bars }, soc, asset, params, fillModel);
      runs.push(r);
      soc = r.endSocMwh;
    }
    return runs;
  };
  const runs = simulate("avg");
  const optimistic = summarize(simulate("touch"), { start, end, asset, params });
  const summary = { ...summarize(runs, { start, end, asset, params }), fillModel: "avg", optimistic };
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
