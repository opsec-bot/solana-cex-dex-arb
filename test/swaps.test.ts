import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSwaps, orient, SOL_MINT, type ParsedTx } from "../src/swaps.js";

// 15 transactions kept from mainnet block 454653033 (log messages stripped), with their original block positions.
const block = JSON.parse(readFileSync(new URL("./fixtures/block-454653033.json", import.meta.url), "utf8")) as {
  slot: number;
  blockTime: number;
  transactions: { index: number; tx: Omit<ParsedTx, "slot" | "blockTime"> }[];
};
const txs = block.transactions.map(({ index, tx }) => ({ index, tx: { ...tx, slot: block.slot, blockTime: block.blockTime } as ParsedTx }));

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const P = {
  bisonfi: "BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi",
  tessera: "TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH",
  orca: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  raydiumClmm: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  dlmm: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpswap: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
};
const ALL = new Set(Object.values(P));
const swaps = txs.flatMap(({ index, tx }) => extractSwaps(tx, ALL, index));

describe("extractSwaps on a real block", () => {
  it("finds swaps on prop AMMs, CLMMs, DLMM and pump.fun", () => {
    const programs = new Set(swaps.map((s) => s.program));
    for (const p of Object.values(P)) expect(programs, p).toContain(p);
  });

  it("prices SOL-USDC fills on four venues within a few bps of each other", () => {
    const sol = swaps.map((s) => ({ s, o: orient(s, SOL_MINT, USDC) })).filter((x) => x.o);
    const venues = new Set(sol.map((x) => x.s.program));
    expect(venues).toEqual(new Set([P.bisonfi, P.tessera, P.orca, P.raydiumClmm]));
    for (const { o } of sol) {
      expect(o!.price).toBeGreaterThan(109.28);
      expect(o!.price).toBeLessThan(109.36);
    }
  });

  it("reads a BisonFi buy exactly", () => {
    const s = swaps.find((x) => x.program === P.bisonfi)!;
    const o = orient(s, SOL_MINT, USDC)!;
    expect(o.side).toBe("buy");
    expect(o.base).toBeCloseTo(0.2266, 4);
    // A relayer paid the fee here; the trader is a different signer.
    const tx = txs.find((t) => t.tx.transaction.signatures[0] === s.signature)!.tx;
    const signers = tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey);
    expect(signers).toContain(s.trader);
    expect(s.trader).not.toBe(s.feePayer);
    expect(s.poolVaults).toHaveLength(2);
  });

  it("gives every swap a block position and a unique instruction path", () => {
    const keys = swaps.map((s) => `${s.signature}:${s.ixPath}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of swaps) expect(s.txIndex).toBeGreaterThanOrEqual(0);
  });

  it("reads pump.fun buys paid in native SOL", () => {
    const s = swaps.find((x) => x.program === P.pump)!;
    expect(s.mintIn).toBe(SOL_MINT);
    expect(s.mintOut.endsWith("pump")).toBe(true);
  });

  it("skips quote updates and failed transactions", () => {
    const quoteOnly = txs.find(({ tx }) => !tx.meta?.err && tx.transaction.message.instructions[0]?.programId === P.tessera && !tx.meta?.innerInstructions?.length)!;
    expect(extractSwaps(quoteOnly.tx, ALL)).toEqual([]);
    const failed = txs.find(({ tx }) => tx.meta?.err)!;
    expect(extractSwaps(failed.tx, ALL)).toEqual([]);
  });
});

describe("extractSwaps on hand-built transactions", () => {
  const tok = (source: string, destination: string, authority: string, amount: number, mint: string, decimals: number) => ({
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    program: "spl-token",
    stackHeight: 2,
    parsed: { type: "transferChecked", info: { source, destination, authority, mint, tokenAmount: { amount: String(amount), decimals } } },
  });
  const tx = (inner: unknown[], signers = ["trader"]): ParsedTx => ({
    slot: 1,
    blockTime: 100,
    meta: { err: null, innerInstructions: [{ index: 0, instructions: inner as never }], preTokenBalances: [], postTokenBalances: [] },
    transaction: {
      signatures: ["sig"],
      message: { accountKeys: signers.map((pubkey) => ({ pubkey, signer: true })), instructions: [{ programId: "POOL", stackHeight: 1 }] },
    },
  });

  it("nets a refund of the input token", () => {
    const s = extractSwaps(
      tx([tok("tA", "vA", "trader", 1000, "A", 0), tok("vA", "tA", "pool", 100, "A", 0), tok("vB", "tB", "pool", 50, "B", 0)]),
      new Set(["POOL"]),
    )[0]!;
    expect([s.mintIn, s.amountIn, s.mintOut, s.amountOut]).toEqual(["A", 900, "B", 50]);
  });

  it("falls back to the first transfer's authority when no trader-side account signed", () => {
    const s = extractSwaps(tx([tok("rA", "vA", "router", 10, "A", 0), tok("vB", "rB", "pool", 20, "B", 0)], ["someone"]), new Set(["POOL"]))[0]!;
    expect(s.trader).toBe("router");
    expect(s.poolVaults).toEqual(["vA", "vB"]);
  });

  it("ignores single-transfer instructions", () => {
    expect(extractSwaps(tx([tok("vB", "tB", "pool", 20, "B", 0)]), new Set(["POOL"]))).toEqual([]);
  });
});
