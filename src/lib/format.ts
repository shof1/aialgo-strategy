export const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")} 円`;
export const fmtDate = (d: string) => `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
export const signClass = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
export const fixed = (n: number | null | undefined, digits = 2) => (n == null ? "–" : n.toFixed(digits));
