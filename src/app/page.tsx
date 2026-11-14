import Link from "next/link";
import { loadBacktest } from "@/lib/repo/results";
import { fixed, fmtDate, signClass, yen } from "@/lib/format";


export default async function Home() {
  const data = await loadBacktest();
  if (!data) {
    return (
      <div className="panel">
        <h2>Trade Results</h2>
        <p className="muted">結果がまだありません。<code>npm run fetch:jepx</code> → <code>npm run backtest</code> を実行してください。</p>
      </div>
    );
  }
  const { summary: s, runs } = data;
  const cap = s.asset.capacityMwh;
  return (
    <>
      <p className="muted">
        バックテスト {fmtDate(s.start)} 〜 {fmtDate(s.end)}（{s.days} 日）· 買 &lt; {s.params.buyBelowYen} 円 / 売 &gt;{" "}
        {s.params.sellTiersYen.join(" / > ")} 円 · 各最大 {s.params.maxSellBlocks} コマ
      </p>
      <div className="kpis">
        <div className="kpi"><div className="label">純損益（保守的: 平均価格で約定判定）</div><div className={`value num ${signClass(s.netYen)}`}>{yen(s.netYen)}</div></div>
        <div className="kpi"><div className="label">純損益（楽観的: 高値/安値タッチで約定）</div><div className={`value num ${signClass(s.optimistic.netYen)}`}>{yen(s.optimistic.netYen)}</div></div>
        <div className="kpi"><div className="label">比較: スポット裁定（安7充電/高7放電）</div><div className="value num">{yen(s.baselineNetYen)}</div></div>
        <div className="kpi"><div className="label">約定 買 / 売（保守的）</div><div className="value num"><span className="buy">{s.buyFills}</span> / <span className="sell">{s.sellFills}</span></div></div>
        <div className="kpi"><div className="label">取引のあった日</div><div className="value num">{s.daysWithTrades} / {s.days}</div></div>
        <div className="kpi"><div className="label">SOC 制約違反</div><div className={`value num ${s.socViolations ? "neg" : "pos"}`}>{s.socViolations}</div></div>
      </div>
      <div className="note">
        EPRX は約定履歴データが未整備のため、入札計画のみ作成し収益は 0 として計上しています。時間前データは JEPX 公開の全エリア四本値（コマ単位）で、板・約定の明細ではありません。
      </div>
      <div className="panel">
        <h2>日付コード別</h2>
        <table>
          <thead>
            <tr>
              <th>日付コード</th><th>東京スポット 最低–最高</th><th>注文</th><th>買 / 売 約定</th>
              <th>純損益</th><th>比較: スポット裁定</th><th className="l">終了 SOC</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.dateCode}>
                <td><Link href={`/runs/${r.dateCode}`}>{r.dateCode}</Link></td>
                <td className="num">{fixed(Math.min(...r.spotYen))} – {fixed(Math.max(...r.spotYen))}</td>
                <td className="num">{r.stats.ordersPlaced}</td>
                <td className="num"><span className="buy">{r.stats.buyFills}</span> / <span className="sell">{r.stats.sellFills}</span></td>
                <td className={`num ${signClass(r.pnl.netYen)}`}>{yen(r.pnl.netYen)}</td>
                <td className="num muted">{yen(r.baseline.netYen)}</td>
                <td className="l">
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div className="socbar"><i style={{ width: `${(r.endSocMwh / cap) * 100}%` }} /></div>
                    <span className="num">{fixed(r.endSocMwh)} MWh</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
