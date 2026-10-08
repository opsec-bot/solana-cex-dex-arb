import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flowOf, ownerDeltas, tipLamports } from "../src/features.js";
import { extractSwaps, orient, SOL_MINT, type ParsedTx } from "../src/swaps.js";
import { MINTS, VENUES } from "../src/venues.js";

const block = JSON.parse(readFileSync(new URL("./fixtures/block-454653033.json", import.meta.url), "utf8")) as {
  slot: number;
  blockTime: number;
  transactions: { index: number; tx: Omit<ParsedTx, "slot" | "blockTime"> }[];
};
const at = (i: number) => ({ ...block.transactions.find((t) => t.index === i)!.tx, slot: block.slot, blockTime: block.blockTime }) as ParsedTx;

describe("tips", () => {
  it("reads real Jito tips", () => {
    expect(tipLamports(at(18))).toBe(1_000_000);
    expect(tipLamports(at(508))).toBe(1000);
    expect(tipLamports(at(20))).toBe(0);
  });
});

describe("ownerDeltas and flow on real SOL-USDC fills", () => {
  const programs = new Set(VENUES.map((v) => v.program));
  const fills = block.transactions.flatMap(({ index }) =>
    extractSwaps(at(index), programs, index).flatMap((s) => {
      const o = orient(s, MINTS.SOL, MINTS.USDC);
      return o ? [{ s, o, tx: at(index) }] : [];
    }),
  );

  it("sees each trader's SOL and USDC move opposite ways on a plain swap", () => {
    expect(fills.length).toBeGreaterThan(0);
    const flows = fills.map(({ s, o, tx }) => flowOf(ownerDeltas(tx, s.trader), o, MINTS.SOL, MINTS.USDC));
    expect(flows).toContain("directional");
    const plain = fills.find(({ s, o, tx }) => flowOf(ownerDeltas(tx, s.trader), o, MINTS.SOL, MINTS.USDC) === "directional")!;
    const d = ownerDeltas(plain.tx, plain.s.trader);
    expect(Math.abs(d.get(SOL_MINT)!)).toBeCloseTo(plain.o.base, 2);
    expect(Math.abs(d.get(MINTS.USDC)!)).toBeCloseTo(plain.o.quote, 2);
  });

  it("calls the BisonFi fill 'other': it is the middle hop of a USDC to SOL to memecoin route", () => {
    const bison = fills.find(({ s }) => s.program === "BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi")!;
    const d = ownerDeltas(bison.tx, bison.s.trader);
    expect(d.get(MINTS.USDC)).toBe(-25);
    expect([...d.keys()].some((m) => m.endsWith("pump"))).toBe(true);
    expect(flowOf(d, bison.o, MINTS.SOL, MINTS.USDC)).toBe("other");
  });
});

describe("flowOf", () => {
  const fill = { side: "buy" as const, base: 1, quote: 100 };
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  it("directional, cycle and other", () => {
    expect(flowOf(m({ SOL: 1, USD: -100 }), fill, "SOL", "USD")).toBe("directional");
    expect(flowOf(m({ SOL: -1, USD: 100 }), fill, "SOL", "USD")).toBe("other"); // wrong way round for a buy
    expect(flowOf(m({ USD: 0.3 }), fill, "SOL", "USD")).toBe("cycle");
    expect(flowOf(m({ SOL: 1, USD: -100, BONK: 5 }), fill, "SOL", "USD")).toBe("other");
  });
});
