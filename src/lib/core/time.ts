import type { Block, StepId } from "./types";

/** JST の「壁時計」を扱うため、内部では UTC Date に +9h した値を UTC として扱う */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** "20261112" → Date(2026-11-12T00:00 JST を UTC 表現で) */
export function dateCodeToJstMidnight(dateCode: string): Date {
  const y = Number(dateCode.slice(0, 4));
  const m = Number(dateCode.slice(4, 6));
  const d = Number(dateCode.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d) - JST_OFFSET_MS);
}

export function toDateCode(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return (
    String(j.getUTCFullYear()) +
    String(j.getUTCMonth() + 1).padStart(2, "0") +
    String(j.getUTCDate()).padStart(2, "0")
  );
}

export function addDays(dateCode: string, days: number): string {
  return toDateCode(new Date(dateCodeToJstMidnight(dateCode).getTime() + days * 86400000));
}

/** "2026/11/12" や "2026-11-12" → "20261112" */
export function normalizeDateCode(s: string): string {
  return s.replace(/[^0-9]/g, "").slice(0, 8);
}

/** コマの受渡開始時刻 */
export function blockStart(dateCode: string, block: Block): Date {
  return new Date(dateCodeToJstMidnight(dateCode).getTime() + (block - 1) * 30 * 60000);
}

/** 時間前市場のゲートクローズ = 受渡開始の 60 分前 */
export function gateClose(dateCode: string, block: Block): Date {
  return new Date(blockStart(dateCode, block).getTime() - 60 * 60000);
}

export function blockLabel(block: Block): string {
  const start = (block - 1) * 30;
  const end = start + 30;
  const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `B${String(block).padStart(2, "0")} ${f(start)}–${f(end)}`;
}

/**
 * イントラデイループ（毎時 :10 / :40）で「直後に GC を迎える」コマ。
 * 実行時刻 + 80 分 = 受渡開始（GC は実行の 20 分後）。
 * 例: D-1 22:40 → D の B01、D 22:10 → D の B48。
 */
export function cycleTarget(now: Date): { dateCode: string; block: Block } {
  const start = new Date(now.getTime() + 80 * 60000);
  const dateCode = toDateCode(start);
  const minutes = Math.round((start.getTime() - dateCodeToJstMidnight(dateCode).getTime()) / 60000);
  return { dateCode, block: Math.floor(minutes / 30) + 1 };
}

/** 日付コード D のイントラデイ実行時刻（D-1 22:40 〜 D 22:10、計 48 回） */
export function intradayCycles(dateCode: string): { at: Date; block: Block }[] {
  return Array.from({ length: 48 }, (_, i) => {
    const block = i + 1;
    return { block, at: new Date(blockStart(dateCode, block).getTime() - 80 * 60000) };
  });
}

/** 日付コード D の固定スケジュール（JST、D-1 基準の時刻） */
export const STEP_SCHEDULE: { step: StepId; dayOffset: number; hhmm: string; deadline?: string }[] = [
  { step: "S0_CREATE", dayOffset: -1, hhmm: "09:00" },
  { step: "S1_SPOT_FETCH", dayOffset: -1, hhmm: "10:30" },
  { step: "S2_EPRX_PLAN", dayOffset: -1, hhmm: "13:00" },
  { step: "S3_EPRX_SUBMIT", dayOffset: -1, hhmm: "13:30", deadline: "14:00" },
  { step: "S4_EPRX_RESULT", dayOffset: -1, hhmm: "15:00" },
  { step: "S5_OCCTO_PLAN", dayOffset: -1, hhmm: "16:00" },
  { step: "S6_OCCTO_SUBMIT", dayOffset: -1, hhmm: "16:30", deadline: "17:00" },
  { step: "S7_SOC_PLAN", dayOffset: -1, hhmm: "17:00" },
  { step: "S8_HA_INITIAL", dayOffset: -1, hhmm: "17:10" },
  { step: "S9_INTRADAY", dayOffset: -1, hhmm: "22:40" },
  { step: "S10_SETTLE", dayOffset: 1, hhmm: "08:00" },
];

export function stepTime(dateCode: string, dayOffset: number, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(dateCodeToJstMidnight(dateCode).getTime() + dayOffset * 86400000 + (h * 60 + m) * 60000);
}

/** JST の ISO 文字列（+09:00） */
export function isoJst(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return j.toISOString().replace("Z", "+09:00").replace(".000", "");
}
