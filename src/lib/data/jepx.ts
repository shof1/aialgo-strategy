import { normalizeDateCode } from "../core/time";
import type { IntradayBar } from "../core/types";

/** JEPX 公開 CSV の取得 URL（Referer が必要） */
export const JEPX_CSV = {
  spot: (year: number) => ({
    url: `https://www.jepx.jp/js/csv_read.php?dir=spot_summary&file=spot_summary_${year}.csv`,
    referer: "https://www.jepx.jp/electricpower/market-data/spot/",
  }),
  intraday: (year: number) => ({
    url: `https://www.jepx.jp/js/csv_read.php?dir=intraday&file=intraday_${year}.csv`,
    referer: "https://www.jepx.jp/electricpower/market-data/intraday/",
  }),
};

function rows(csv: string): string[][] {
  return csv
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(","));
}

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** スポット CSV → dateCode → 東京エリアプライス 48 コマ */
export function parseSpotCsv(csv: string, areaColumn = "エリアプライス東京(円/kWh)"): Map<string, number[]> {
  const [header, ...body] = rows(csv);
  const col = header.indexOf(areaColumn);
  if (col < 0) throw new Error(`spot CSV に列がありません: ${areaColumn}`);
  const out = new Map<string, number[]>();
  for (const r of body) {
    const d = normalizeDateCode(r[0]);
    const block = Number(r[1]);
    const price = num(r[col]);
    if (!d || !(block >= 1 && block <= 48) || price == null) continue;
    const arr = out.get(d) ?? new Array<number>(48).fill(NaN);
    arr[block - 1] = price;
    out.set(d, arr);
  }
  return out;
}

/** 時間前 CSV → dateCode → コマ別四本値 */
export function parseIntradayCsv(csv: string): Map<string, IntradayBar[]> {
  const [, ...body] = rows(csv);
  const out = new Map<string, IntradayBar[]>();
  for (const r of body) {
    const d = normalizeDateCode(r[0]);
    const block = Number(r[1]);
    if (!d || !(block >= 1 && block <= 48)) continue;
    const bar: IntradayBar = {
      block,
      open: num(r[2]),
      high: num(r[3]),
      low: num(r[4]),
      close: num(r[5]),
      avg: num(r[6]),
      volumeKwh: num(r[7]) ?? 0,
    };
    out.set(d, [...(out.get(d) ?? []), bar]);
  }
  return out;
}

export function isCompleteSpot(arr: number[] | undefined): arr is number[] {
  return !!arr && arr.length === 48 && arr.every((x) => Number.isFinite(x));
}
