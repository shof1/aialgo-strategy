import { describe, expect, it } from "vitest";
import { socBounds } from "../src/lib/core/soc";
import { catchupSellLimit, decideCycle, planHa } from "../src/lib/core/strategy";
import { DEFAULT_ASSET as A, DEFAULT_PARAMS, type StrategyParams } from "../src/lib/core/types";

const P: StrategyParams = { ...DEFAULT_PARAMS, buyOffsetYen: 0, sellOffsetYen: -1, minSpreadYen: 0, catchupYen: 2 };
// 0:00-6:00 が 20 円、17:00-21:00 が 40 円、他は 30 円
const shaped = () => Array.from({ length: 48 }, (_, i) => (i < 12 ? 20 : i >= 34 && i < 42 ? 40 : 30));
const { min, max } = socBounds(A);

describe("売り切り優先（S9）", () => {
  const plan = planHa(shaped(), [], min, A, P);
  const sells = plan.sellBlocks;

  it("残りの売りコマで売り切れる SOC なら指値を下げない", () => {
    // 最初の売りコマ時点で SOC が 1 コマ分しか無い → 残り R−1 コマで足りる
    expect(catchupSellLimit(sells[0], plan, min + 1, A, P)).toBe(plan.limitYen[sells[0]]);
  });

  it("このコマを逃すと売り切れない SOC なら指値を catchupYen 下げる", () => {
    const last = sells[sells.length - 1];
    // 最後の売りコマで SOC がまだ残っている → 逃すと電気が残る
    expect(catchupSellLimit(last, plan, min + 1, A, P)).toBeCloseTo(plan.limitYen[last] - 2, 6);
    // 満充電で最初の売りコマ（残り全コマでも売り切れない）
    expect(catchupSellLimit(sells[0], plan, max, A, P)).toBeCloseTo(plan.limitYen[sells[0]] - 2, 6);
  });

  it("原価割れ（floorYen）より下げない", () => {
    const last = sells[sells.length - 1];
    const deep = { ...P, catchupYen: 100 };
    expect(catchupSellLimit(last, plan, max, A, deep)).toBe(plan.floorYen);
    expect(plan.floorYen!).toBeGreaterThan(0);
  });

  it("catchupYen = 0 なら従来どおり", () => {
    const last = sells[sells.length - 1];
    expect(catchupSellLimit(last, plan, max, A, { ...P, catchupYen: 0 })).toBe(plan.limitYen[last]);
  });

  it("サイクルの売り注文に反映される", () => {
    const last = sells[sells.length - 1];
    const o = decideCycle(last, plan, { socMwh: max, buysFilled: 0, sellsFilled: 0 }, A, P);
    expect(o?.side).toBe("sell");
    expect(o?.limitYen).toBeCloseTo(plan.limitYen[last] - 2, 6);
  });
});
