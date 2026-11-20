import { baselineSpotArbitrage, runDay, type FillModel, type RunResult } from "./engine";
import { simulateSoc } from "../core/soc";
import { addDays } from "../core/time";
import type { AssetSpec, IntradayBar, StrategyParams } from "../core/types";
import { isCompleteSpot } from "../data/jepx";

export interface MarketData {
  spot: Map<string, number[]>;
  intraday: Map<string, IntradayBar[]>;
}

const yen = (f: { priceYen: number; mwh: number }) => f.priceYen * f.mwh * 1000;

/**
 * start..end の日付コードを順に再生する。初日の開始 SOC は 50%、以降は前日終了 SOC を引継ぐ。
 * スポットが 48 コマ揃わない日は飛ばす（warn に記録）。
 *
 * 比較用ベースライン（スポット裁定）は戦略とは別に自分の SOC を引継ぐ。
 * 戦略の終了 SOC を使うと、戦略を変えるたびにベースラインの値まで変わって比較にならないため。
 */
export function simulatePeriod(
  data: MarketData,
  start: string,
  end: string,
  asset: AssetSpec,
  params: StrategyParams,
  fillModel: FillModel,
  warn: (msg: string) => void = () => {},
): RunResult[] {
  let soc = asset.capacityMwh * 0.5;
  let baseSoc = soc;
  const runs: RunResult[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const s = data.spot.get(d);
    const bars = data.intraday.get(d) ?? [];
    if (!isCompleteSpot(s)) {
      warn(`skip ${d}: スポットデータ不足`);
      continue;
    }
    if (bars.length < 48) warn(`${d}: 時間前データ ${bars.length}/48 コマ`);
    const r = runDay({ dateCode: d, spotYen: s, intraday: bars }, soc, asset, params, fillModel);
    const baseFills = baselineSpotArbitrage(s, baseSoc, asset, params.maxSellBlocks);
    const baseNet =
      baseFills.filter((f) => f.side === "sell").reduce((a, f) => a + yen(f), 0) -
      baseFills.filter((f) => f.side === "buy").reduce((a, f) => a + yen(f), 0);
    r.baseline = { netYen: baseNet, fills: baseFills };
    baseSoc = simulateSoc(asset, baseSoc, baseFills)[48];
    runs.push(r);
    soc = r.endSocMwh;
  }
  return runs;
}
