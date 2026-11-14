import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RunResult } from "../backtest/engine";
import type { BacktestSummary } from "../backtest/summary";

export interface BacktestFile {
  summary: BacktestSummary & { fillModel: string; optimistic: BacktestSummary };
  runs: RunResult[];
}

/**
 * Trade Results のデータ取得口。
 * 現在はバックテスト結果ファイル（data/backtest/latest.json）を読む。
 * Supabase 接続後は runs / action_logs / ha_orders から読む実装に差し替える。
 */
export async function loadBacktest(): Promise<BacktestFile | null> {
  "use cache";
  try {
    const text = await readFile(path.join(process.cwd(), "data/backtest/latest.json"), "utf8");
    return JSON.parse(text) as BacktestFile;
  } catch {
    return null;
  }
}
