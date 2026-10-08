import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReport, classify, toMarkdown } from "../src/arb.js";
import { klinesToPoints, PriceSeries } from "../src/prices.js";
import { fillsFromBlock, type ArbFill } from "../src/scan.js";
import type { ParsedTx } from "../src/swaps.js";

const fill = (over: Partial<ArbFill>): ArbFill => ({
  signature: "s",
  slot: 1,
  txIndex: 0,
  blockTime: 10,
  venue: "V",
  program: "P",
  trader: "T",
  side: "buy",
  base: 10,
  quote: 999,
  price: 99.9,
  flow: "directional",
  tipLamports: 0,
  feeLamports: 5000,
  swapsInTx: 1,
  ...over,
});

const flat = new PriceSeries([[0, 100], [100, 100]]);

describe("classify", () => {
  it("labels a tipped directional fill that beat Binance as CEX-DEX and prices it", () => {
    const [c] = classify([fill({ tipLamports: 1_000_000 })], flat);
    expect(c!.label).toBe("cex-dex");
    expect(c!.edgeBps).toBeCloseTo(10.01, 2);
    expect(c!.gross).toBeCloseTo(1, 9); // 10 SOL worth 1000, paid 999
    expect(c!.costs).toBeCloseTo((1_005_000 / 1e9) * 100, 9);
  });

  it("needs a tip or repeat trading", () => {
    expect(classify([fill({})], flat)[0]!.label).toBe("none");
    const three = [1, 2, 3].map((i) => fill({ signature: `s${i}` }));
    expect(classify(three, flat).every((c) => c.label === "cex-dex")).toBe(true);
  });

  it("rejects fills that were worse than Binance or not directional", () => {
    expect(classify([fill({ tipLamports: 1, price: 100.1, quote: 1001 })], flat)[0]!.label).toBe("none");
    expect(classify([fill({ tipLamports: 1, flow: "other" })], flat)[0]!.label).toBe("none");
    expect(classify([fill({ flow: "cycle" })], flat)[0]!.label).toBe("atomic");
  });

  it("uses the hedge delay", () => {
    const moving = new PriceSeries([[10, 100], [12, 99]]);
    expect(classify([fill({ tipLamports: 1 })], moving, { hedgeDelaySec: 2 })[0]!.label).toBe("none");
  });
});

describe("buildReport", () => {
  it("adds up searchers, concentration and venues", () => {
    const fills = [
      fill({ signature: "a", trader: "big", tipLamports: 1, base: 100, quote: 9990 }),
      fill({ signature: "b", trader: "big", tipLamports: 1, base: 100, quote: 9990 }),
      fill({ signature: "c", trader: "small", tipLamports: 1 }),
      fill({ signature: "d", trader: "retail", venue: "W", price: 100.2, quote: 1002 }),
    ];
    const r = buildReport(fills, flat);
    expect(r.cexDex.fills).toBe(3);
    expect(r.searchers.map((s) => s.trader)).toEqual(["big", "small"]);
    expect(r.concentration.top1).toBeGreaterThan(0.9);
    const v = r.venues.find((x) => x.venue === "V")!;
    expect(v.cexDexShare).toBe(1);
    expect(r.venues.find((x) => x.venue === "W")!.cexDexShare).toBe(0);
    expect(toMarkdown(r)).toContain("| `big` | 2 |");
  });

  it("runs on a real block with real Binance prices", () => {
    const block = JSON.parse(readFileSync(new URL("./fixtures/block-454653033.json", import.meta.url), "utf8"));
    const full: ParsedTx[] = [];
    for (const { index, tx } of block.transactions) full[index] = { ...tx, slot: block.slot, blockTime: block.blockTime };
    const fills = fillsFromBlock(full.filter(Boolean)).map((f, i) => ({ ...f, txIndex: i }));
    const rows = JSON.parse(readFileSync(new URL("./fixtures/binance-SOLUSDC-1s.json", import.meta.url), "utf8"));
    const r = buildReport(fills, new PriceSeries(klinesToPoints(rows)));
    expect(r.fills).toBe(fills.length);
    expect(r.priced).toBe(fills.length);
    expect(r.venues.length).toBeGreaterThan(1);
  });
});
