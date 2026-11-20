import { describe, expect, it } from "vitest";
import { runDay } from "../src/lib/backtest/engine";
import { socBounds } from "../src/lib/core/soc";
import { decideCycle, planHa } from "../src/lib/core/strategy";
import { DEFAULT_ASSET as A, DEFAULT_PARAMS, type IntradayBar, type StrategyParams } from "../src/lib/core/types";

const P: StrategyParams = { ...DEFAULT_PARAMS, buyOffsetYen: -1, sellOffsetYen: 1, minSpreadYen: 2 };
// 0:00-6:00 が 20 円、17:00-21:00 が 40 円、他は 30 円（実データに近い水準。固定しきい値 < 1 円では一度も買えない）
const shaped = () => Array.from({ length: 48 }, (_, i) => (i < 12 ? 20 : i >= 34 && i < 42 ? 40 : 30));
const bar = (block: number, avg: number): IntradayBar => ({ block, open: avg, high: avg + 3, low: avg - 3, close: avg, avg, volumeKwh: 1e5 });

describe("スポット連動しきい値", () => {
  it("指値はそのコマのスポット ± オフセット", () => {
    const spot = shaped();
    const plan = planHa(spot, [], socBounds(A).min, A, P);
    expect(plan.buyBlocks.length).toBeGreaterThan(0);
    for (const b of plan.buyBlocks) expect(plan.limitYen[b]).toBeCloseTo(spot[b - 1] - 1, 6);
    for (const b of plan.sellBlocks) expect(plan.limitYen[b]).toBeCloseTo(spot[b - 1] + 1, 6);
  });

  it("充電は安いコマ・放電は高いコマで、充電が先", () => {
    const plan = planHa(shaped(), [], socBounds(A).min, A, P);
    expect(plan.buyBlocks.every((b) => b <= 12)).toBe(true);
    expect(plan.sellBlocks.every((b) => b >= 35 && b <= 42)).toBe(true);
    expect(Math.max(...plan.buyBlocks)).toBeLessThan(Math.min(...plan.sellBlocks));
  });

  it("SOC 下限スタートでも計画した売りは全て出せる（売れない計画を作らない）", () => {
    const plan = planHa(shaped(), [], socBounds(A).min, A, P);
    const sells = plan.plannedOrders.filter((o) => o.side === "sell");
    expect(sells.length).toBe(plan.sellBlocks.length);
    const { min, max } = socBounds(A);
    for (const s of plan.socPlan) {
      expect(s).toBeGreaterThanOrEqual(min - 1e-9);
      expect(s).toBeLessThanOrEqual(max + 1e-9);
    }
  });

  it("利ざやが minSpread に届かない日は何もしない", () => {
    const flat = new Array(48).fill(30);
    const plan = planHa(flat, [], socBounds(A).min, A, P);
    expect(plan.plannedOrders).toEqual([]);
  });

  it("高値が安値より前の日は、SOC が空なら売らない", () => {
    const p = Array.from({ length: 48 }, (_, i) => (i < 8 ? 50 : i >= 40 ? 10 : 30));
    const plan = planHa(p, [], socBounds(A).min, A, P);
    expect(plan.plannedOrders.filter((o) => o.side === "sell").every((o) => o.block > Math.min(...plan.buyBlocks))).toBe(true);
  });

  it("前日から SOC を持ち越していれば、朝の高値でも売る", () => {
    const p = Array.from({ length: 48 }, (_, i) => (i < 8 ? 50 : i >= 40 ? 10 : 30));
    const plan = planHa(p, [], socBounds(A).max, A, P);
    expect(plan.sellBlocks.some((b) => b <= 8)).toBe(true);
  });

  it("EPRX 約定コマは使わない", () => {
    const plan = planHa(shaped(), [36, 37], socBounds(A).min, A, P);
    expect(plan.sellBlocks).not.toContain(36);
    expect(plan.sellBlocks).not.toContain(37);
  });

  it("サイクルの注文は計画の指値を使う", () => {
    const plan = planHa(shaped(), [], socBounds(A).min, A, P);
    const b = plan.buyBlocks[0];
    const o = decideCycle(b, plan, { socMwh: socBounds(A).min, buysFilled: 0, sellsFilled: 0 }, A, P);
    expect(o?.limitYen).toBe(plan.limitYen[b]);
  });

  it("1 日を実行して、実データ水準の価格でも約定し利益が出る", () => {
    const spot = shaped();
    const bars = spot.map((p, i) => bar(i + 1, p));
    const r = runDay({ dateCode: "20261112", spotYen: spot, intraday: bars }, socBounds(A).min, A, { ...P, buyOffsetYen: 0, sellOffsetYen: 0 });
    expect(r.stats.socOk).toBe(true);
    expect(r.stats.buyFills).toBeGreaterThan(0);
    expect(r.stats.sellFills).toBeGreaterThan(0);
    expect(r.pnl.netYen).toBeGreaterThan(0);
  });
});
