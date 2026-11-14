import { NextResponse, type NextRequest } from "next/server";
import { dueJobs } from "@/lib/core/scheduler";

/**
 * pg_cron（毎分）から呼ばれる入口。Authorization: Bearer <CRON_SECRET> が必要。
 * 現段階では実行すべきジョブを判定して返すのみ（コネクタ接続後に job_queue へ投入・実行する）。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const at = req.nextUrl.searchParams.get("at");
  const now = at ? new Date(at) : new Date();
  return NextResponse.json({ now: now.toISOString(), jobs: dueJobs(now) });
}
