import { describe, expect, it } from "vitest";
import { matchOrder, runDay } from "../src/lib/backtest/engine";
import { canExecute, maxExecutable, simulateSoc, socBounds } from "../src/lib/core/soc";
import { decideCycle, planEprxBids, planHa, sellTierFor } from "../src/lib/core/strategy";
import { blockLabel, cycleTarget, gateClose, intradayCycles, isoJst } from "../src/lib/core/time";
import { DEFAULT_ASSET as A, DEFAULT_PARAMS as P, type IntradayBar } from "../src/lib/core/types";
import { parseIntradayCsv, parseSpotCsv } from "../src/lib/data/jepx";

const jst = (s: string) => new Date(s + "+09:00");

describe("time", () => {
  it("B01 の GC は前日 23:00", () => {
    expect(isoJst(gateClose("20261112", 1))).toBe("2026-11-11T23:00:00+09:00");
  });
  it("22:40 のサイクルは翌日 B01、23:10 は B02、22:10 は当日 B48", () => {
    expect(cycleTarget(jst("2026-11-11T22:40:00"))).toEqual({ dateCode: "20261112", block: 1 });
    expect(cycleTarget(jst("2026-11-11T23:10:00"))).toEqual({ dateCode: "20261112", block: 2 });
    expect(cycleTarget(jst("2026-11-12T22:10:00"))).toEqual({ dateCode: "20261112", block: 48 });
    expect(cycleTarget(jst("2026-11-12T13:40:00"))).toEqual({ dateCode: "20261112", block: 31 }); // 15:00 開始
  });
  it("イントラデイは 48 回、D-1 22:40 から D 22:10", () => {
    const c = intradayCycles("20261112");
    expect(c).toHaveLength(48);
    expect(isoJst(c[0].at)).toBe("2026-11-11T22:40:00+09:00");
    expect(isoJst(c[47].at)).toBe("2026-11-12T22:10:00+09:00");
  });
  it("コマ表記", () => expect(blockLabel(48)).toBe("B48 23:30–24:00"));
});

describe("soc", () => {
  it("1 コマは 1 MWh、上限を超える充電は不可", () => {
    const { max, min } = socBounds(A);
    expect(maxExecutable(A, max, "buy")).toBe(0);
    expect(maxExecutable(A, min, "sell")).toBe(0);
    expect(maxExecutable(A, 4, "buy")).toBe(1);
    expect(canExecute(A, 4, "sell", 1.5)).toBe(false);
  });
  it("往復効率が反映される", () => {
    const path = simulateSoc(A, 4, [
      { block: 1, side: "buy", limitYen: 0, mwh: 1, priceYen: 0 },
      { block: 2, side: "sell", limitYen: 0, mwh: 1, priceYen: 0 },
    ]);
    expect(path[48]).toBeCloseTo(4 + Math.sqrt(0.85) - 1 / Math.sqrt(0.85), 6);
  });
});

describe("strategy", () => {
  const spot = Array.from({ length: 48 }, (_, i) => 10 + i); // B48 が最高値
  it("EPRX は高値の 7 コマを選ぶ", () => {
    const bids = planEprxBids({ spotYen: spot }, A, P);
    expect(bids.map((b) => b.block)).toEqual([42, 43, 44, 45, 46, 47, 48]);
  });
  it("売り段: 価格を超える最大のしきい値", () => {
    expect(sellTierFor(45, [30, 40])).toBe(40);
    expect(sellTierFor(35, [30, 40])).toBe(30);
    expect(sellTierFor(10, [30, 40])).toBe(30);
  });
  it("時間前計画は EPRX 約定コマを除外し、SOC 制約を守る", () => {
    const plan = planHa(spot, [48], 0.4, A, P);
    expect(plan.sellBlocks).not.toContain(48);
    expect(plan.buyBlocks).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const { min, max } = socBounds(A);
    for (const s of plan.socPlan) {
      expect(s).toBeGreaterThanOrEqual(min - 1e-9);
      expect(s).toBeLessThanOrEqual(max + 1e-9);
    }
  });
  it("SOC が下限なら売り注文を出さない", () => {
    const plan = planHa(spot, [], 4, A, P);
    const o = decideCycle(plan.sellBlocks[0], plan, { socMwh: socBounds(A).min, buysFilled: 0, sellsFilled: 0 }, A, P);
    expect(o).toBeNull();
  });
});

describe("backtest", () => {
  const bar = (block: number, high: number, low: number): IntradayBar => ({ block, open: low, high, low, close: low, avg: low, volumeKwh: 1000 });
  it("楽観モデルは高値/安値タッチで約定", () => {
    expect(matchOrder({ block: 1, side: "sell", limitYen: 30.01, mwh: 1 }, bar(1, 31, 10), "touch")?.priceYen).toBe(30.01);
    expect(matchOrder({ block: 1, side: "sell", limitYen: 30.01, mwh: 1 }, bar(1, 29, 10), "touch")).toBeNull();
    expect(matchOrder({ block: 1, side: "buy", limitYen: 0.99, mwh: 1 }, bar(1, 10, 0.01), "touch")?.priceYen).toBe(0.99);
  });
  it("保守モデル（既定）は加重平均で判定し、単発の安値では約定しない", () => {
    const b = { block: 1, open: 10, high: 31, low: 0.01, close: 10, avg: 11, volumeKwh: 1000 };
    expect(matchOrder({ block: 1, side: "buy", limitYen: 0.99, mwh: 1 }, b)).toBeNull();
    expect(matchOrder({ block: 1, side: "sell", limitYen: 30.01, mwh: 1 }, b)).toBeNull();
    expect(matchOrder({ block: 1, side: "sell", limitYen: 10.01, mwh: 1 }, b)?.priceYen).toBe(10.01);
  });
  it("1 日分を実行でき、SOC 違反がない", () => {
    const spot = Array.from({ length: 48 }, (_, i) => (i < 12 ? 0.5 : i > 34 ? 45 : 15));
    const bars = spot.map((p, i) => bar(i + 1, p + 2, Math.max(0.01, p - 1)));
    const r = runDay({ dateCode: "20261112", spotYen: spot, intraday: bars }, 1, A, P);
    expect(r.stats.socOk).toBe(true);
    expect(r.stats.buyFills).toBeGreaterThan(0);
    expect(r.stats.sellFills).toBeGreaterThan(0);
    expect(r.stats.buyFills).toBeLessThanOrEqual(7);
    expect(r.stats.sellFills).toBeLessThanOrEqual(7);
    expect(r.pnl.netYen).toBeGreaterThan(0);
  });
});

describe("jepx csv", () => {
  it("スポットと時間前を読む", () => {
    const head = "受渡日,時刻コード,a,b,c,システムプライス(円/kWh),エリアプライス北海道(円/kWh),エリアプライス東北(円/kWh),エリアプライス東京(円/kWh)";
    const spot = parseSpotCsv(`﻿${head}\n2026/11/12,1,0,0,0,10,11,12,13.5\n`);
    expect(spot.get("20261112")?.[0]).toBe(13.5);
    const intra = parseIntradayCsv("年月日,時刻コード,始値,高値,安値,終値,平均,量,件数\n2026/11/12,3,1,2,0.5,1.5,1.2,1000,5\n");
    expect(intra.get("20261112")?.[0]).toMatchObject({ block: 3, high: 2, low: 0.5, volumeKwh: 1000 });
  });
});

import { dueJobs } from "../src/lib/core/scheduler";
describe("scheduler", () => {
  it("13:00 は翌日 Run の EPRX 計画", () => {
    expect(dueJobs(jst("2026-11-11T13:00:00"))).toEqual([{ dateCode: "20261112", step: "S2_EPRX_PLAN" }]);
  });
  it("22:40 は当日 Run の S9 開始（固定）と翌日 B01 のサイクル", () => {
    const j = dueJobs(jst("2026-11-11T22:40:00"));
    expect(j).toContainEqual({ dateCode: "20261112", step: "S9_INTRADAY", block: 1 });
  });
  it("10:40 は当日 Run の B25（12:00–）サイクル（翌日 Run の準備と重なる時間帯）", () => {
    expect(dueJobs(jst("2026-11-12T10:40:00"))).toEqual([{ dateCode: "20261112", step: "S9_INTRADAY", block: 25 }]);
  });
  it("08:00 は前日 Run の精算", () => {
    expect(dueJobs(jst("2026-11-13T08:00:00"))).toEqual([{ dateCode: "20261112", step: "S10_SETTLE" }]);
  });
});
