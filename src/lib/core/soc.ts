import type { AssetSpec, Block, Fill, Side } from "./types";

/** 1 コマ（30 分）で受渡できる最大電力量 MWh */
export function blockMwh(asset: AssetSpec): number {
  return asset.powerMw * 0.5;
}

export function socBounds(asset: AssetSpec): { min: number; max: number } {
  return { min: asset.capacityMwh * asset.minSocRatio, max: asset.capacityMwh * asset.maxSocRatio };
}

/** 受渡端の電力量 → 蓄電池内部の SOC 変化（充電は √η 倍、放電は 1/√η 倍を消費） */
export function socDelta(asset: AssetSpec, side: Side, gridMwh: number): number {
  const e = Math.sqrt(asset.roundTripEfficiency);
  return side === "buy" ? gridMwh * e : -gridMwh / e;
}

const EPS = 1e-9;

export function canExecute(asset: AssetSpec, socMwh: number, side: Side, gridMwh: number): boolean {
  if (gridMwh > blockMwh(asset) + EPS) return false;
  const next = socMwh + socDelta(asset, side, gridMwh);
  const { min, max } = socBounds(asset);
  return next >= min - EPS && next <= max + EPS;
}

/** SOC から、そのコマで売れる / 買える最大の受渡電力量 */
export function maxExecutable(asset: AssetSpec, socMwh: number, side: Side): number {
  const { min, max } = socBounds(asset);
  const e = Math.sqrt(asset.roundTripEfficiency);
  const raw = side === "buy" ? (max - socMwh) / e : (socMwh - min) * e;
  return Math.max(0, Math.min(blockMwh(asset), raw));
}

/** コマ終了時点の SOC 推移（index 0 = 開始時、index b = B b 終了時） */
export function simulateSoc(asset: AssetSpec, startSocMwh: number, fills: Fill[]): number[] {
  const byBlock = new Map<Block, Fill[]>();
  for (const f of fills) byBlock.set(f.block, [...(byBlock.get(f.block) ?? []), f]);
  const path = [startSocMwh];
  let soc = startSocMwh;
  for (let b = 1; b <= 48; b++) {
    for (const f of byBlock.get(b) ?? []) soc += socDelta(asset, f.side, f.mwh);
    path.push(soc);
  }
  return path;
}

/** SOC 推移が上下限に収まっているか */
export function validateSocPath(asset: AssetSpec, path: number[]): { ok: boolean; violations: number[] } {
  const { min, max } = socBounds(asset);
  const violations = path.flatMap((s, i) => (s < min - 1e-6 || s > max + 1e-6 ? [i] : []));
  return { ok: violations.length === 0, violations };
}
