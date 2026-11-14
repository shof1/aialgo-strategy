/**
 * JEPX 公開 CSV（スポット・時間前）を data/jepx/ に保存する。
 * 使い方: npm run fetch:jepx -- 2026
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { JEPX_CSV } from "../src/lib/data/jepx";

async function download(url: string, referer: string, out: string) {
  const res = await fetch(url, { headers: { Referer: referer, "User-Agent": "ai-algo-bot/0.1" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (text.length < 1000) throw new Error(`内容が小さすぎます (${text.length} bytes): ${url}`);
  await writeFile(out, text);
  console.log(`saved ${out} (${text.length.toLocaleString()} bytes)`);
}

async function main() {
  const years = process.argv.slice(2).map(Number).filter(Boolean);
  if (years.length === 0) years.push(new Date().getFullYear());
  const dir = path.join(process.cwd(), "data/jepx");
  await mkdir(dir, { recursive: true });
  for (const y of years) {
    const s = JEPX_CSV.spot(y);
    const i = JEPX_CSV.intraday(y);
    await download(s.url, s.referer, path.join(dir, `spot_${y}.csv`));
    await download(i.url, i.referer, path.join(dir, `intraday_${y}.csv`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
