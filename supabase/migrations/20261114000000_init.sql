-- AI-Algo Bot 初期スキーマ（docs/process-design.md §6）

create table if not exists runs (
  date_code   text primary key check (date_code ~ '^\d{8}$'),
  mode        text not null default 'test' check (mode in ('test','live','backtest')),
  status      text not null default 'CREATED',
  start_soc_mwh numeric,
  end_soc_mwh   numeric,
  pnl         jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists run_steps (
  date_code   text not null references runs(date_code) on delete cascade,
  step        text not null,
  status      text not null default 'pending' check (status in ('pending','running','done','failed','skipped')),
  attempts    int not null default 0,
  started_at  timestamptz,
  finished_at timestamptz,
  error       text,
  primary key (date_code, step)           -- 冪等性: 同じステップは 1 行のみ
);

create table if not exists action_logs (
  id          bigint generated always as identity primary key,
  date_code   text not null references runs(date_code) on delete cascade,
  step        text not null,
  level       text not null default 'info' check (level in ('info','warn','error')),
  message     text not null,
  payload     jsonb,
  ts          timestamptz not null default now()
);
create index if not exists action_logs_run_ts on action_logs (date_code, ts);

create table if not exists spot_results (
  date_code   text not null,
  block       smallint not null check (block between 1 and 48),
  area        text not null default 'tokyo',
  price_yen   numeric not null,
  primary key (date_code, block, area)
);

create table if not exists intraday_bars (
  date_code   text not null,
  block       smallint not null check (block between 1 and 48),
  open numeric, high numeric, low numeric, close numeric, avg numeric,
  volume_kwh  numeric not null default 0,
  primary key (date_code, block)
);

create table if not exists eprx_bids (
  id          bigint generated always as identity primary key,
  date_code   text not null references runs(date_code) on delete cascade,
  block       smallint not null check (block between 1 and 48),
  product     text,
  mw          numeric not null,
  price_yen   numeric,
  score       numeric,
  status      text not null default 'draft' check (status in ('draft','submitted','awarded','rejected')),
  created_at  timestamptz not null default now()
);

create table if not exists occto_plans (
  id          bigint generated always as identity primary key,
  date_code   text not null references runs(date_code) on delete cascade,
  version     int not null default 1,
  payload     jsonb not null,
  submitted_at timestamptz,
  unique (date_code, version)
);

create table if not exists soc_plan (
  date_code   text not null references runs(date_code) on delete cascade,
  block       smallint not null check (block between 0 and 48),  -- 0 = 開始時
  target_soc_mwh numeric not null,
  min_soc_mwh numeric,
  max_soc_mwh numeric,
  reserved_for_eprx boolean not null default false,
  primary key (date_code, block)
);

create table if not exists soc_readings (
  ts          timestamptz primary key,
  soc_mwh     numeric not null,
  power_kw    numeric
);

create table if not exists ha_orders (
  id          bigint generated always as identity primary key,
  date_code   text not null references runs(date_code) on delete cascade,
  block       smallint not null check (block between 1 and 48),
  side        text not null check (side in ('buy','sell')),
  limit_yen   numeric not null,
  mwh         numeric not null,
  tier        numeric,
  status      text not null default 'placed' check (status in ('placed','filled','partial','cancelled','expired')),
  filled_mwh  numeric not null default 0,
  fill_price_yen numeric,
  created_at  timestamptz not null default now()
);
create index if not exists ha_orders_run on ha_orders (date_code, block);

create table if not exists strategy_params (
  id          bigint generated always as identity primary key,
  key         text not null,
  value       jsonb not null,
  version     int not null,
  changed_by  text,
  changed_at  timestamptz not null default now(),
  unique (key, version)
);

-- ジョブキュー: pg_cron が (date_code, step) を投入し、ワーカー / API が取り出す
create table if not exists job_queue (
  id          bigint generated always as identity primary key,
  date_code   text not null,
  step        text not null,
  block       smallint,                 -- S9 の対象コマ
  run_at      timestamptz not null,
  deadline    timestamptz,
  status      text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts    int not null default 0,
  locked_by   text,
  locked_at   timestamptz,
  unique (date_code, step, block)
);

-- RLS: 画面は認証ユーザーのみ参照可、書き込みは service_role（ジョブ）のみ
do $$
declare t text;
begin
  foreach t in array array['runs','run_steps','action_logs','spot_results','intraday_bars','eprx_bids',
                           'occto_plans','soc_plan','soc_readings','ha_orders','strategy_params','job_queue']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on %I', t);
    execute format('create policy "read for authenticated" on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- pg_cron（Supabase ダッシュボードで pg_cron / pg_net 拡張を有効化した上で、
-- <APP_URL> と <CRON_SECRET> を置き換えて実行する）
-- select cron.schedule('ai-algo-intraday', '10,40 * * * *', $$
--   select net.http_post(url := '<APP_URL>/api/jobs/tick',
--                        headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'));
-- $$);
-- ※ pg_cron は UTC。/api/jobs/tick 側で JST に変換して該当ステップを判定する。
-- 毎分 tick にして、アプリ側で STEP_SCHEDULE と照合する方式でもよい:
-- select cron.schedule('ai-algo-tick', '* * * * *', $$ ... $$);
