import { addDays, cycleTarget, STEP_SCHEDULE, stepTime, toDateCode } from "./time";
import type { Block, StepId } from "./types";

export interface DueJob {
  dateCode: string;
  step: StepId;
  block?: Block;
}

/**
 * 現在時刻（分単位）に実行すべきジョブ。2 つの Run が重なる時間帯は両方返す。
 * 毎分の tick（pg_cron）から呼ばれる想定。
 */
export function dueJobs(now: Date): DueJob[] {
  const minute = Math.floor(now.getTime() / 60000);
  const jobs: DueJob[] = [];
  const today = toDateCode(now);
  // 固定スケジュール: D-1 / D / D+1 基準のどれかが今の分に一致するか
  for (const D of [addDays(today, -1), today, addDays(today, 1)]) {
    for (const s of STEP_SCHEDULE) {
      if (s.step === "S9_INTRADAY") continue;
      if (Math.floor(stepTime(D, s.dayOffset, s.hhmm).getTime() / 60000) === minute) jobs.push({ dateCode: D, step: s.step });
    }
  }
  // イントラデイ: 毎時 :10 / :40
  const jstMin = new Date(now.getTime() + 9 * 3600000).getUTCMinutes();
  if (jstMin === 10 || jstMin === 40) {
    const t = cycleTarget(now);
    jobs.push({ dateCode: t.dateCode, step: "S9_INTRADAY", block: t.block });
  }
  return jobs;
}
