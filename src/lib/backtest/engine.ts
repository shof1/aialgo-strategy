import { simulateSoc, socDelta, maxExecutable, validateSocPath } from "../core/soc";
import { decideCycle, planEprxBids, planHa, type EprxBidPlan, type HaPlan } from "../core/strategy";
import { blockLabel, intradayCycles, isoJst, STEP_SCHEDULE, stepTime } from "../core/time";
import type { ActionLog, AssetSpec, Block, Fill, IntradayBar, LogLevel, Order, StepId, StrategyParams } from "../core/types";

export interface DayInputs {
  dateCode: string;
  spotYen: number[]; // 東京エリアプライス 48 コマ
  intraday: IntradayBar[]; // 時間前 四本値 48 コマ
  eprxHistoryYen?: (number | null)[];
  reserveMarginPct?: (number | null)[];
}

export interface RunResult {
  dateCode: string;
  mode: "backtest";
  fillModel: FillModel;
  startSocMwh: number;
  endSocMwh: number;
  eprxBids: EprxBidPlan[];
  eprxAwarded: Block[];
  plan: HaPlan;
  orders: Order[];
  fills: Fill[];
  socPath: number[];
  spotYen: number[];
  intraday: IntradayBar[];
  pnl: { revenueYen: number; costYen: number; eprxYen: number; netYen: number };
  baseline: { netYen: number; fills: Fill[] };
  stats: { buyFills: number; sellFills: number; ordersPlaced: number; socOk: boolean };
  logs: ActionLog[];
}

const yen = (f: Fill) => f.priceYen * f.mwh * 1000;

/**
 * 約定モデル
 * - "avg"  : コマの加重平均価格が指値を越えたら約定（保守的・既定）
 * - "touch": 高値/安値が指値に触れたら約定（楽観的。0.01 円などの単発約定でも約定扱いになる）
 * 約定価格はどちらも指値で計上。
 */
export type FillModel = "avg" | "touch";

export function matchOrder(order: Order, bar: IntradayBar | undefined, model: FillModel = "avg"): Fill | null {
  if (!bar || bar.volumeKwh <= 0) return null;
  const buyRef = model === "avg" ? bar.avg : bar.low;
  const sellRef = model === "avg" ? bar.avg : bar.high;
  if (order.side === "buy" && buyRef != null && buyRef <= order.limitYen) return { ...order, priceYen: order.limitYen };
  if (order.side === "sell" && sellRef != null && sellRef >= order.limitYen) return { ...order, priceYen: order.limitYen };
  return null;
}

/**
 * 比較用ベースライン: スポット価格を事前に知っていたとして、
 * 安い 7 コマで充電・高い 7 コマで放電（時刻順に SOC 制約を満たす分だけ）。
 */
export function baselineSpotArbitrage(spotYen: number[], startSoc: number, asset: AssetSpec, n = 7): Fill[] {
  const ranked = spotYen.map((p, i) => ({ block: i + 1, p }));
  const buys = new Set([...ranked].sort((a, b) => a.p - b.p).slice(0, n).map((x) => x.block));
  const sells = new Set([...ranked].filter((x) => !buys.has(x.block)).sort((a, b) => b.p - a.p).slice(0, n).map((x) => x.block));
  const fills: Fill[] = [];
  let soc = startSoc;
  for (let b = 1; b <= 48; b++) {
    const side = buys.has(b) ? "buy" : sells.has(b) ? "sell" : null;
    if (!side) continue;
    const mwh = maxExecutable(asset, soc, side);
    if (mwh <= 0.001) continue;
    fills.push({ block: b, side, limitYen: spotYen[b - 1], mwh, priceYen: spotYen[b - 1] });
    soc += socDelta(asset, side, mwh);
  }
  return fills;
}

export function runDay(
  inp: DayInputs,
  startSocMwh: number,
  asset: AssetSpec,
  params: StrategyParams,
  fillModel: FillModel = "avg",
): RunResult {
  const D = inp.dateCode;
  const logs: ActionLog[] = [];
  const sched = Object.fromEntries(STEP_SCHEDULE.map((s) => [s.step, s]));
  const log = (step: StepId, message: string, payload?: unknown, level: LogLevel = "info", at?: Date) => {
    const s = sched[step];
    logs.push({ dateCode: D, step, ts: isoJst(at ?? stepTime(D, s.dayOffset, s.hhmm)), level, message, payload });
  };

  log("S0_CREATE", `Run ${D} 起票（mode=backtest, 約定モデル=${fillModel}, 開始 SOC ${startSocMwh.toFixed(2)} MWh）`);

  const maxSpot = Math.max(...inp.spotYen);
  const minSpot = Math.min(...inp.spotYen);
  log("S1_SPOT_FETCH", `スポット約定取得: 東京 最高 ${maxSpot.toFixed(2)} / 最低 ${minSpot.toFixed(2)} 円/kWh`, { spotYen: inp.spotYen });

  const eprxBids = planEprxBids(inp, asset, params);
  log("S2_EPRX_PLAN", `EPRX 入札計画: ${eprxBids.map((b) => `B${String(b.block).padStart(2, "0")}`).join(", ")}`, eprxBids);
  const hasEprxPrice = eprxBids.some((b) => b.priceYen != null);
  log(
    "S3_EPRX_SUBMIT",
    hasEprxPrice ? "EPRX 入札（バックテスト: 仮想提出）" : "EPRX 入札価格の根拠データなし → 提出スキップ（履歴データ未整備）",
    undefined,
    hasEprxPrice ? "info" : "warn",
  );
  // EPRX の約定履歴データが未整備のため、バックテストでは約定なしとして扱う
  const eprxAwarded: Block[] = [];
  log("S4_EPRX_RESULT", `EPRX 約定: ${eprxAwarded.length} コマ`, eprxAwarded);

  const plan = planHa(inp.spotYen, eprxAwarded, startSocMwh, asset, params);
  log("S5_OCCTO_PLAN", `OCCTO 計画作成: 計画注文 ${plan.plannedOrders.length} 件`, plan.plannedOrders);
  log("S6_OCCTO_SUBMIT", "OCCTO 計画提出（バックテスト: 仮想提出）");
  log("S7_SOC_PLAN", `SOC 計画 B01–B48 作成（計画終了 SOC ${plan.socPlan[48].toFixed(2)} MWh）`, { socPlan: plan.socPlan });
  log(
    "S8_HA_INITIAL",
    `時間前 初期入札: 買い候補 ${plan.buyBlocks.length} コマ（< ${params.buyBelowYen} 円）、売り候補 ${plan.sellBlocks.length} コマ（> ${params.sellTiersYen.join(" / > ")} 円）`,
    { buyBlocks: plan.buyBlocks, sellBlocks: plan.sellBlocks, sellTier: plan.sellTier },
  );

  // S9: 30 分毎のサイクル（D-1 22:40 → D 22:10）
  const bars = new Map(inp.intraday.map((b) => [b.block, b]));
  const orders: Order[] = [];
  const fills: Fill[] = [];
  let soc = startSocMwh;
  let buysFilled = 0;
  let sellsFilled = 0;
  for (const { at, block } of intradayCycles(D)) {
    const order = decideCycle(block, plan, { socMwh: soc, buysFilled, sellsFilled }, asset, params);
    if (!order) continue;
    orders.push(order);
    const fill = matchOrder(order, bars.get(block), fillModel);
    const bar = bars.get(block);
    const range = bar ? `時間前 平均 ${bar.avg ?? "-"} / 高 ${bar.high ?? "-"} / 安 ${bar.low ?? "-"}` : "時間前データなし";
    if (fill) {
      fills.push(fill);
      soc += socDelta(asset, fill.side, fill.mwh);
      if (fill.side === "buy") buysFilled++;
      else sellsFilled++;
      log("S9_INTRADAY", `${blockLabel(block)} ${fill.side === "buy" ? "買" : "売"} ${fill.mwh.toFixed(2)} MWh @ ${fill.priceYen} 円 約定（${range}）→ SOC ${soc.toFixed(2)} MWh`, fill, "info", at);
    } else {
      log("S9_INTRADAY", `${blockLabel(block)} ${order.side === "buy" ? "買" : "売"} 指値 ${order.limitYen} 円 未約定（${range}）`, order, "info", at);
    }
  }

  const socPath = simulateSoc(asset, startSocMwh, fills);
  const check = validateSocPath(asset, socPath);
  const revenueYen = fills.filter((f) => f.side === "sell").reduce((a, f) => a + yen(f), 0);
  const costYen = fills.filter((f) => f.side === "buy").reduce((a, f) => a + yen(f), 0);
  const eprxYen = 0;
  const baseFills = baselineSpotArbitrage(inp.spotYen, startSocMwh, asset, params.maxSellBlocks);
  const baseNet =
    baseFills.filter((f) => f.side === "sell").reduce((a, f) => a + yen(f), 0) -
    baseFills.filter((f) => f.side === "buy").reduce((a, f) => a + yen(f), 0);
  const netYen = revenueYen - costYen + eprxYen;
  log(
    "S10_SETTLE",
    `精算: 売 ${Math.round(revenueYen).toLocaleString()} 円 − 買 ${Math.round(costYen).toLocaleString()} 円 = ${Math.round(netYen).toLocaleString()} 円（終了 SOC ${socPath[48].toFixed(2)} MWh）`,
    { revenueYen, costYen, eprxYen, netYen },
    check.ok ? "info" : "error",
  );

  return {
    dateCode: D,
    mode: "backtest",
    fillModel,
    startSocMwh,
    endSocMwh: socPath[48],
    eprxBids,
    eprxAwarded,
    plan,
    orders,
    fills,
    socPath,
    spotYen: inp.spotYen,
    intraday: inp.intraday,
    pnl: { revenueYen, costYen, eprxYen, netYen },
    baseline: { netYen: baseNet, fills: baseFills },
    stats: { buyFills: buysFilled, sellFills: sellsFilled, ordersPlaced: orders.length, socOk: check.ok },
    logs,
  };
}
