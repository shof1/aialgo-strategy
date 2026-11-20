/** 30 分コマ番号 1..48（B01 = 00:00–00:30） */
export type Block = number;

export const BLOCKS: Block[] = Array.from({ length: 48 }, (_, i) => i + 1);

/** 蓄電所の仕様 */
export interface AssetSpec {
  area: "tokyo";
  powerMw: number; // 定格出力
  capacityMwh: number; // 容量
  roundTripEfficiency: number; // 往復効率 η（充電・放電に √η ずつ配分）
  minSocRatio: number; // SOC 下限（容量比）
  maxSocRatio: number; // SOC 上限（容量比）
}

export const DEFAULT_ASSET: AssetSpec = {
  area: "tokyo",
  powerMw: 2,
  capacityMwh: 8,
  roundTripEfficiency: 0.85,
  minSocRatio: 0.05,
  maxSocRatio: 0.95,
};

/** 戦略パラメータ（strategy_params テーブルで管理する値） */
export interface StrategyParams {
  eprxBlocks: number; // EPRX 入札コマ数
  maxBuyBlocks: number; // 時間前 買い 最大コマ数
  maxSellBlocks: number; // 時間前 売り 最大コマ数（全段合計）
  /**
   * 時間前の指値の決め方
   * - "fixed"        : 固定しきい値（買 < buyBelowYen、売 > sellTiersYen）… v0.2 の方式
   * - "spotRelative" : そのコマのスポット約定価格（D-1 10:30 に確定済み）± オフセット
   */
  thresholdMode: "fixed" | "spotRelative";
  buyBelowYen: number; // fixed: 買い条件 価格 < この値
  sellTiersYen: number[]; // fixed: 売り段 価格 > 各値（昇順）
  buyOffsetYen: number; // spotRelative: 買い指値 = スポット + この値（負なら割安でしか買わない）
  sellOffsetYen: number; // spotRelative: 売り指値 = スポット + この値
  minSpreadYen: number; // spotRelative: 売り指値 × η − 買い指値 がこの値未満の組は計画しない
}

/** v0.2 の固定しきい値（比較用） */
export const FIXED_PARAMS: StrategyParams = {
  eprxBlocks: 7,
  maxBuyBlocks: 7,
  maxSellBlocks: 7,
  thresholdMode: "fixed",
  buyBelowYen: 1,
  sellTiersYen: [30, 40],
  buyOffsetYen: 0,
  sellOffsetYen: 0,
  minSpreadYen: 0,
};

/**
 * 既定: スポット連動。オフセットは scripts/sweep.ts（直前 60 日で学習 → 次の 30 日で検証）で選んだ値。
 * 3 回の検証のうち 2 回で学習期間の最良が「買 ±0 / 売 −1 円」だったのでこれを採用。
 * 本番では毎月 sweep を回し直して更新する想定。
 */
export const DEFAULT_PARAMS: StrategyParams = {
  ...FIXED_PARAMS,
  thresholdMode: "spotRelative",
  buyOffsetYen: 0,
  sellOffsetYen: -1,
  minSpreadYen: 0,
};

export type Side = "buy" | "sell";

export interface Order {
  block: Block;
  side: Side;
  limitYen: number; // 円/kWh
  mwh: number; // 受渡端の電力量
  tier?: number; // 売り段（しきい値）
}

export interface Fill extends Order {
  priceYen: number;
}

/** JEPX 時間前のコマ別四本値（システム全体） */
export interface IntradayBar {
  block: Block;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  avg: number | null;
  volumeKwh: number;
}

export type RunMode = "test" | "live" | "backtest";

export type StepId =
  | "S0_CREATE"
  | "S1_SPOT_FETCH"
  | "S2_EPRX_PLAN"
  | "S3_EPRX_SUBMIT"
  | "S4_EPRX_RESULT"
  | "S5_OCCTO_PLAN"
  | "S6_OCCTO_SUBMIT"
  | "S7_SOC_PLAN"
  | "S8_HA_INITIAL"
  | "S9_INTRADAY"
  | "S10_SETTLE";

export type LogLevel = "info" | "warn" | "error";

export interface ActionLog {
  dateCode: string;
  step: StepId;
  ts: string; // ISO (JST offset)
  level: LogLevel;
  message: string;
  payload?: unknown;
}
