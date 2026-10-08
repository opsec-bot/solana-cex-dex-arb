import type { PriceSeries } from "./prices.js";
import type { ArbFill } from "./scan.js";
import { gini, hhi, round } from "./stats.js";

export interface ArbOptions {
  /** Seconds after the fill at which the searcher is assumed to hedge on Binance. */
  hedgeDelaySec?: number;
  /** A fill must beat the hedge price by more than this many bps. */
  minEdgeBps?: number;
  /** Traders with this many qualifying fills count as searchers even without tips. */
  minTrades?: number;
}

export type Label = "cex-dex" | "atomic" | "none";

export interface Classified {
  fill: ArbFill;
  label: Label;
  /** Binance mid at the hedge time, or null if missing. */
  hedgeMid: number | null;
  /** s (m - p) / p in bps. */
  edgeBps: number | null;
  /** In quote. Only for cex-dex fills. */
  gross: number;
  costs: number;
  net: number;
}

/**
 * Labels fills. CEX-DEX: directional flow, beat the hedge price by more than minEdgeBps, and a Jito tip or at least
 * minTrades such fills by the same trader. Atomic: the fill was undone in the same transaction (flow "cycle").
 */
export function classify(fills: ArbFill[], prices: PriceSeries, opts: ArbOptions = {}): Classified[] {
  const delay = opts.hedgeDelaySec ?? 0;
  const minEdge = opts.minEdgeBps ?? 0;
  const minTrades = opts.minTrades ?? 3;

  const pre = fills.map((fill) => {
    const m = prices.at(fill.blockTime + delay);
    const s = fill.side === "buy" ? 1 : -1;
    const edgeBps = m === null ? null : ((s * (m - fill.price)) / fill.price) * 10_000;
    const candidate = fill.flow === "directional" && edgeBps !== null && edgeBps > minEdge;
    return { fill, m, s, edgeBps, candidate };
  });
  const counts = new Map<string, number>();
  for (const p of pre) if (p.candidate) counts.set(p.fill.trader, (counts.get(p.fill.trader) ?? 0) + 1);

  return pre.map(({ fill, m, s, edgeBps, candidate }) => {
    const searcher = fill.tipLamports > 0 || (counts.get(fill.trader) ?? 0) >= minTrades;
    const label: Label = candidate && searcher ? "cex-dex" : fill.flow === "cycle" ? "atomic" : "none";
    if (label !== "cex-dex" || m === null) return { fill, label, hedgeMid: m, edgeBps, gross: 0, costs: 0, net: 0 };
    const gross = s * (fill.base * m - fill.quote);
    // A transaction's tip and fee are shared by its fills.
    const costs = (((fill.tipLamports + fill.feeLamports) / 1e9) * m) / fill.swapsInTx;
    return { fill, label, hedgeMid: m, edgeBps, gross, costs, net: gross - costs };
  });
}

export interface SearcherRow {
  trader: string;
  fills: number;
  volume: number;
  net: number;
  tipsSol: number;
  share: number;
}

export interface VenueRow {
  venue: string;
  fills: number;
  volume: number;
  cexDexVolume: number;
  cexDexShare: number;
  /** Net profit arbitrageurs made trading against this venue. */
  takenFromVenue: number;
}

export interface ArbReport {
  options: Required<ArbOptions>;
  fills: number;
  priced: number;
  cexDex: { fills: number; volume: number; gross: number; costs: number; net: number };
  atomic: { fills: number; volume: number };
  concentration: { searchers: number; hhi: number; top1: number; top3: number; top10: number; gini: number };
  searchers: SearcherRow[];
  venues: VenueRow[];
}

export function buildReport(fills: ArbFill[], prices: PriceSeries, opts: ArbOptions = {}): ArbReport {
  const options = { hedgeDelaySec: opts.hedgeDelaySec ?? 0, minEdgeBps: opts.minEdgeBps ?? 0, minTrades: opts.minTrades ?? 3 };
  const c = classify(fills, prices, options);
  const arb = c.filter((x) => x.label === "cex-dex");
  const sum = (xs: Classified[], f: (x: Classified) => number) => xs.reduce((a, x) => a + f(x), 0);

  const bySearcher = new Map<string, Classified[]>();
  for (const x of arb) bySearcher.set(x.fill.trader, [...(bySearcher.get(x.fill.trader) ?? []), x]);
  const totalNet = sum(arb, (x) => x.net);
  const searchers: SearcherRow[] = [...bySearcher]
    .map(([trader, xs]) => {
      const tipped = new Map(xs.map((x) => [x.fill.signature, x.fill.tipLamports]));
      return {
        trader,
        fills: xs.length,
        volume: round(sum(xs, (x) => x.fill.quote), 2),
        net: round(sum(xs, (x) => x.net), 2),
        tipsSol: round([...tipped.values()].reduce((a, b) => a + b, 0) / 1e9, 6),
        share: totalNet > 0 ? round(sum(xs, (x) => x.net) / totalNet) : 0,
      };
    })
    .sort((a, b) => b.net - a.net || a.trader.localeCompare(b.trader));

  const profits = searchers.map((s) => Math.max(0, s.net));
  const topShare = (k: number) => {
    const total = profits.reduce((a, b) => a + b, 0);
    return total > 0 ? round(profits.slice(0, k).reduce((a, b) => a + b, 0) / total) : 0;
  };

  const byVenue = new Map<string, Classified[]>();
  for (const x of c) byVenue.set(x.fill.venue, [...(byVenue.get(x.fill.venue) ?? []), x]);
  const venues: VenueRow[] = [...byVenue]
    .map(([venue, xs]) => {
      const volume = sum(xs, (x) => x.fill.quote);
      const arbXs = xs.filter((x) => x.label === "cex-dex");
      const cexDexVolume = sum(arbXs, (x) => x.fill.quote);
      return {
        venue,
        fills: xs.length,
        volume: round(volume, 2),
        cexDexVolume: round(cexDexVolume, 2),
        cexDexShare: volume > 0 ? round(cexDexVolume / volume) : 0,
        takenFromVenue: round(sum(arbXs, (x) => x.gross), 2),
      };
    })
    .sort((a, b) => b.volume - a.volume);

  const atomic = c.filter((x) => x.label === "atomic");
  return {
    options,
    fills: fills.length,
    priced: c.filter((x) => x.hedgeMid !== null).length,
    cexDex: {
      fills: arb.length,
      volume: round(sum(arb, (x) => x.fill.quote), 2),
      gross: round(sum(arb, (x) => x.gross), 2),
      costs: round(sum(arb, (x) => x.costs), 2),
      net: round(totalNet, 2),
    },
    atomic: { fills: atomic.length, volume: round(sum(atomic, (x) => x.fill.quote), 2) },
    concentration: {
      searchers: searchers.length,
      hhi: searchers.length ? round(hhi(profits.map((p) => p || 0))) : 0,
      top1: topShare(1),
      top3: topShare(3),
      top10: topShare(10),
      gini: searchers.length > 1 ? round(gini(profits)) : 0,
    },
    searchers,
    venues,
  };
}

export function toMarkdown(r: ArbReport): string {
  const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const p = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `Fills: ${r.fills} (${r.priced} priced). Hedge ${r.options.hedgeDelaySec}s after the fill, min edge ${r.options.minEdgeBps} bps, searcher = tip or ${r.options.minTrades}+ fills.`,
    "",
    `CEX-DEX: ${r.cexDex.fills} fills, ${n(r.cexDex.volume)} volume, gross ${n(r.cexDex.gross)}, costs ${n(r.cexDex.costs)}, net ${n(r.cexDex.net)}`,
    `Atomic (undone in the same transaction): ${r.atomic.fills} fills, ${n(r.atomic.volume)} volume`,
    `Concentration of net profit: ${r.concentration.searchers} searchers, HHI ${r.concentration.hhi}, top 1 ${p(r.concentration.top1)}, top 3 ${p(r.concentration.top3)}, Gini ${r.concentration.gini}`,
    "",
    "| Searcher | Fills | Volume | Net | Tips (SOL) | Share |",
    "|---|---:|---:|---:|---:|---:|",
    ...r.searchers.slice(0, 15).map((s) => `| \`${s.trader}\` | ${s.fills} | ${n(s.volume)} | ${n(s.net)} | ${s.tipsSol} | ${p(s.share)} |`),
    "",
    "| Venue | Fills | Volume | CEX-DEX volume | CEX-DEX share | Taken by arbitrage |",
    "|---|---:|---:|---:|---:|---:|",
    ...r.venues.map((v) => `| ${v.venue} | ${v.fills} | ${n(v.volume)} | ${n(v.cexDexVolume)} | ${p(v.cexDexShare)} | ${n(v.takenFromVenue)} |`),
    "",
    "Amounts in quote (USDC). Binance taker fees are not subtracted.",
  ];
  return lines.join("\n");
}
