# AI-Algo Bot

系統用蓄電所（東京エリア 2 MW / 8 MWh）向けの JEPX スポット / EPRX / JEPX 時間前 / OCCTO 計画提出の自動運用ボット。
設計: [docs/process-design.md](docs/process-design.md)

## 使い方

```bash
npm install
npm test                      # ロジックの単体テスト
npm run fetch:jepx -- 2026    # JEPX 公開 CSV（スポット・時間前）を取得
npm run backtest -- 20261113 30   # 終了日コード・日数でバックテスト → data/backtest/latest.json
npm run dev                   # Trade Results 画面 http://localhost:3000
```

## 構成
- `src/lib/core/` 時刻・SOC・戦略・スケジューラ（純粋関数、本番とバックテストで共通）
- `src/lib/backtest/` バックテストエンジン
- `src/app/` Trade Results 画面、`/api/jobs/tick`（pg_cron の呼び出し口、`CRON_SECRET` 必須）
- `supabase/migrations/` DB スキーマ

デプロイ: Vercel（環境変数 `CRON_SECRET`、Supabase 接続後は `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`）
