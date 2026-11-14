import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadBacktest } from "@/lib/repo/results";
import { blockLabel } from "@/lib/core/time";
import { fixed, fmtDate, signClass, yen } from "@/lib/format";


const STEP_NAMES: Record<string, string> = {
  S0_CREATE: "S0 起票",
  S1_SPOT_FETCH: "S1 スポット取得",
  S2_EPRX_PLAN: "S2 EPRX 計画",
  S3_EPRX_SUBMIT: "S3 EPRX 入札",
  S4_EPRX_RESULT: "S4 EPRX 約定",
  S5_OCCTO_PLAN: "S5 OCCTO 計画",
  S6_OCCTO_SUBMIT: "S6 OCCTO 提出",
  S7_SOC_PLAN: "S7 SOC 計画",
  S8_HA_INITIAL: "S8 時間前 初期入札",
  S9_INTRADAY: "S9 イントラデイ",
  S10_SETTLE: "S10 精算",
};

export async function generateStaticParams() {
  const data = await loadBacktest();
  return (data?.runs ?? []).map((r) => ({ dateCode: r.dateCode }));
}

export default function RunPage({ params }: { params: Promise<{ dateCode: string }> }) {
  return (
    <Suspense fallback={<p className="muted">読み込み中…</p>}>
      <RunView params={params} />
    </Suspense>
  );
}

async function RunView({ params }: { params: Promise<{ dateCode: string }> }) {
  const { dateCode } = await params;
  const data = await loadBacktest();
  const idx = data?.runs.findIndex((r) => r.dateCode === dateCode) ?? -1;
  if (!data || idx < 0) notFound();
  const r = data.runs[idx];
  const prev = data.runs[idx - 1]?.dateCode;
  const next = data.runs[idx + 1]?.dateCode;
  const cap = data.summary.asset.capacityMwh;
  const fills = new Map(r.fills.map((f) => [f.block, f]));
  const orders = new Map(r.orders.map((o) => [o.block, o]));
  const eprx = new Set(r.eprxBids.map((b) => b.block));
  const buyPlan = new Set(r.plan.buyBlocks);
  const sellPlan = new Set(r.plan.sellBlocks);

  return (
    <>
      <p>
        <Link href="/">← 一覧</Link>
        {prev && <> · <Link href={`/runs/${prev}`}>{prev}</Link></>}
        {next && <> · <Link href={`/runs/${next}`}>{next}</Link></>}
      </p>
      <h2 style={{ margin: "8px 0 0" }}>日付コード {dateCode}（受渡日 {fmtDate(dateCode)}）</h2>
      <div className="kpis">
        <div className="kpi"><div className="label">純損益</div><div className={`value num ${signClass(r.pnl.netYen)}`}>{yen(r.pnl.netYen)}</div></div>
        <div className="kpi"><div className="label">売上 / 買付</div><div className="value num">{yen(r.pnl.revenueYen)} / {yen(r.pnl.costYen)}</div></div>
        <div className="kpi"><div className="label">比較: スポット裁定</div><div className="value num muted">{yen(r.baseline.netYen)}</div></div>
        <div className="kpi"><div className="label">SOC 開始 → 終了</div><div className="value num">{fixed(r.startSocMwh)} → {fixed(r.endSocMwh)} MWh</div></div>
      </div>

      <div className="panel">
        <h2>動作ログ</h2>
        <ul className="timeline">
          {r.logs.map((l, i) => (
            <li key={i}>
              <span className="num muted">{l.ts.replace("T", " ").replace("+09:00", "")}</span>
              <span>{STEP_NAMES[l.step] ?? l.step} {l.level !== "info" && <span className={`badge ${l.level}`}>{l.level}</span>}</span>
              <span>{l.message}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>48 コマ</h2>
        <table>
          <thead>
            <tr>
              <th>コマ</th><th>東京スポット</th><th>時間前 平均</th><th>高 / 安</th><th className="l">計画</th>
              <th className="l">注文</th><th className="l">約定</th><th className="l">SOC（コマ終了）</th>
            </tr>
          </thead>
          <tbody>
            {r.spotYen.map((p, i) => {
              const b = i + 1;
              const bar = r.intraday.find((x) => x.block === b);
              const o = orders.get(b);
              const f = fills.get(b);
              const soc = r.socPath[b];
              return (
                <tr key={b}>
                  <td className="num">{blockLabel(b)}</td>
                  <td className="num">{fixed(p)}</td>
                  <td className="num">{fixed(bar?.avg)}</td>
                  <td className="num muted">{fixed(bar?.high)} / {fixed(bar?.low)}</td>
                  <td className="l">
                    {eprx.has(b) && <span className="badge">EPRX 候補</span>}{" "}
                    {buyPlan.has(b) && <span className="buy">買候補</span>}
                    {sellPlan.has(b) && <span className="sell">売候補 &gt;{r.plan.sellTier[b]}</span>}
                  </td>
                  <td className={`l num ${o?.side ?? ""}`}>{o ? `${o.side === "buy" ? "買" : "売"} ${fixed(o.mwh)} MWh @ ${o.limitYen}` : ""}</td>
                  <td className={`l num ${f?.side ?? ""}`}>{f ? `✓ ${fixed(f.mwh)} MWh` : o ? <span className="muted">未約定</span> : ""}</td>
                  <td className="l">
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div className="socbar"><i style={{ width: `${(soc / cap) * 100}%` }} /></div>
                      <span className="num">{fixed(soc)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
