import { blockMwh, maxExecutable, socDelta } from "./soc";
import type { AssetSpec, Block, Order, StrategyParams } from "./types";

// ───────────────────────── EPRX（S2） ─────────────────────────

export interface EprxInputs {
  spotYen: number[]; // 48 コマ、index 0 = B01（東京エリアプライス）
  reserveMarginPct?: (number | null)[]; // 広域予備率（低いほど逼迫）
  eprxHistoryYen?: (number | null)[]; // 過去の同時間帯 EPRX 約定価格（基準値）
}

export interface EprxBidPlan {
  block: Block;
  score: number;
  mw: number;
  priceYen: number | null; // null = 価格根拠なし（履歴データ未整備）
}

function zscores(xs: (number | null)[]): number[] {
  const v = xs.filter((x): x is number => x != null);
  if (v.length < 2) return xs.map(() => 0);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
  return xs.map((x) => (x == null ? 0 : (x - mean) / sd));
}

/**
 * 高値になると思われる N コマを選ぶ。
 * スコア = z(スポット価格) + z(EPRX 履歴価格) − z(予備率)
 */
export function planEprxBids(inp: EprxInputs, asset: AssetSpec, params: StrategyParams): EprxBidPlan[] {
  const zs = zscores(inp.spotYen);
  const zh = inp.eprxHistoryYen ? zscores(inp.eprxHistoryYen) : zs.map(() => 0);
  const zr = inp.reserveMarginPct ? zscores(inp.reserveMarginPct) : zs.map(() => 0);
  return zs
    .map((z, i) => ({
      block: i + 1,
      score: z + zh[i] - zr[i],
      mw: asset.powerMw,
      priceYen: inp.eprxHistoryYen?.[i] ?? null,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, params.eprxBlocks)
    .sort((a, b) => a.block - b.block);
}

// ─────────────────── 時間前 ラダー計画（S7 / S8） ───────────────────

export interface HaPlan {
  buyBlocks: Block[];
  sellBlocks: Block[];
  sellTier: Record<Block, number>;
  /** 全計画注文が約定した場合の SOC 推移（index b = B b 終了時） */
  socPlan: number[];
  plannedOrders: Order[];
}

/** 売りの段: スポット価格を超える最大のしきい値（どれも超えなければ最低段） */
export function sellTierFor(spotYen: number, tiers: number[]): number {
  const sorted = [...tiers].sort((a, b) => a - b);
  let tier = sorted[0];
  for (const t of sorted) if (spotYen > t) tier = t;
  return tier;
}

/** 指値: 「> t」は t + 0.01 円、「< t」は t − 0.01 円 */
export const sellLimit = (tier: number) => Math.round((tier + 0.01) * 100) / 100;
export const buyLimit = (below: number) => Math.round((below - 0.01) * 100) / 100;

/**
 * スポット価格を翌日の時間前価格の予測値とみなし、
 * 安いコマを買い候補、高いコマを売り候補にする（EPRX 約定コマは除外）。
 * その上で時刻順に SOC 制約を満たす注文だけを計画に残す。
 */
export function planHa(
  spotYen: number[],
  eprxAwarded: Block[],
  startSocMwh: number,
  asset: AssetSpec,
  params: StrategyParams,
): HaPlan {
  const excluded = new Set(eprxAwarded);
  const ranked = spotYen.map((p, i) => ({ block: i + 1, p })).filter((x) => !excluded.has(x.block));
  const buyBlocks = [...ranked].sort((a, b) => a.p - b.p).slice(0, params.maxBuyBlocks).map((x) => x.block);
  const buySet = new Set(buyBlocks);
  const sellBlocks = [...ranked]
    .filter((x) => !buySet.has(x.block))
    .sort((a, b) => b.p - a.p)
    .slice(0, params.maxSellBlocks)
    .map((x) => x.block);
  const sellTier: Record<Block, number> = {};
  for (const b of sellBlocks) sellTier[b] = sellTierFor(spotYen[b - 1], params.sellTiersYen);

  const sellSet = new Set(sellBlocks);
  const plannedOrders: Order[] = [];
  const socPlan = [startSocMwh];
  let soc = startSocMwh;
  for (let b = 1; b <= 48; b++) {
    if (buySet.has(b)) {
      const mwh = maxExecutable(asset, soc, "buy");
      if (mwh > 0.001) {
        plannedOrders.push({ block: b, side: "buy", limitYen: buyLimit(params.buyBelowYen), mwh });
        soc += socDelta(asset, "buy", mwh);
      }
    } else if (sellSet.has(b)) {
      const mwh = maxExecutable(asset, soc, "sell");
      if (mwh > 0.001) {
        plannedOrders.push({ block: b, side: "sell", limitYen: sellLimit(sellTier[b]), mwh, tier: sellTier[b] });
        soc += socDelta(asset, "sell", mwh);
      }
    }
    socPlan.push(soc);
  }
  return {
    buyBlocks: [...buyBlocks].sort((a, b) => a - b),
    sellBlocks: [...sellBlocks].sort((a, b) => a - b),
    sellTier,
    socPlan,
    plannedOrders,
  };
}

// ─────────────────── イントラデイ 1 サイクル（S9） ───────────────────

export interface IntradayState {
  socMwh: number; // 対象コマ開始時点の見込み SOC（約定済みを反映）
  buysFilled: number;
  sellsFilled: number;
}

/**
 * 対象コマの最終注文を決める。実 SOC（約定反映済み）から執行可能量を再計算し、
 * 計画どおりの量が出せなければ量を減らす / 出さない。
 */
export function decideCycle(
  block: Block,
  plan: HaPlan,
  state: IntradayState,
  asset: AssetSpec,
  params: StrategyParams,
): Order | null {
  if (plan.buyBlocks.includes(block) && state.buysFilled < params.maxBuyBlocks) {
    const mwh = Math.min(blockMwh(asset), maxExecutable(asset, state.socMwh, "buy"));
    if (mwh > 0.001) return { block, side: "buy", limitYen: buyLimit(params.buyBelowYen), mwh };
    return null;
  }
  if (plan.sellBlocks.includes(block) && state.sellsFilled < params.maxSellBlocks) {
    const mwh = Math.min(blockMwh(asset), maxExecutable(asset, state.socMwh, "sell"));
    const tier = plan.sellTier[block];
    if (mwh > 0.001) return { block, side: "sell", limitYen: sellLimit(tier), mwh, tier };
    return null;
  }
  return null;
}
