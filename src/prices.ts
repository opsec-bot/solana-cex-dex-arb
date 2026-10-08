/**
 * Reference prices: one close price per second, from Binance's public market data mirror
 * (data-api.binance.vision), which needs no key and is reachable from the US.
 */

export const BINANCE_DATA_API = "https://data-api.binance.vision";

/** Close price for each second, keyed by unix second. Seconds with no trades carry the last close forward. */
export class PriceSeries {
  private readonly start: number;
  private readonly closes: Float64Array;

  constructor(points: [number, number][]) {
    if (points.length === 0) throw new Error("empty price series");
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    this.start = sorted[0]![0];
    const end = sorted.at(-1)![0];
    this.closes = new Float64Array(end - this.start + 1).fill(NaN);
    for (const [t, p] of sorted) this.closes[t - this.start] = p;
    for (let i = 1; i < this.closes.length; i++) if (Number.isNaN(this.closes[i])) this.closes[i] = this.closes[i - 1]!;
  }

  get first(): number {
    return this.start;
  }

  get last(): number {
    return this.start + this.closes.length - 1;
  }

  /** Close at second `t`, or null if `t` is outside the series. */
  at(t: number): number | null {
    const i = Math.floor(t) - this.start;
    if (i < 0 || i >= this.closes.length) return null;
    return this.closes[i]!;
  }

  toJSON(): [number, number][] {
    return Array.from(this.closes, (p, i) => [this.start + i, p] as [number, number]);
  }
}

/** Parses Binance kline rows ([openTimeMs, open, high, low, close, ...]) into [unixSecond, close] points. */
export function klinesToPoints(rows: unknown[][]): [number, number][] {
  return rows.map((r) => [Math.floor(Number(r[0]) / 1000), Number(r[4])]);
}

/** 1 second closes for `symbol` (e.g. SOLUSDC) covering [fromSec, toSec]. Pages 1000 seconds per request. */
export async function fetchBinanceSeconds(
  symbol: string,
  fromSec: number,
  toSec: number,
  fetchFn: typeof fetch = fetch,
  base = BINANCE_DATA_API,
): Promise<PriceSeries> {
  const points: [number, number][] = [];
  for (let t = fromSec; t <= toSec; t += 1000) {
    const end = Math.min(toSec, t + 999);
    const url = `${base}/api/v3/klines?symbol=${symbol}&interval=1s&startTime=${t * 1000}&endTime=${end * 1000 + 999}&limit=1000`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`binance klines: HTTP ${res.status}`);
    points.push(...klinesToPoints((await res.json()) as unknown[][]));
  }
  return new PriceSeries(points);
}
