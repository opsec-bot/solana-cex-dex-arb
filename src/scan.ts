import { flowOf, ownerDeltas, tipLamports, type Flow } from "./features.js";
import { pool, type Rpc } from "./rpc.js";
import { extractSwaps, orient, type ParsedTx } from "./swaps.js";
import { MINTS, VENUES, type Venue } from "./venues.js";

/** One SOL-USDC fill with the shape of the transaction around it. The line format of fills.jsonl. */
export interface ArbFill {
  signature: string;
  slot: number;
  txIndex: number;
  blockTime: number;
  venue: string;
  program: string;
  trader: string;
  side: "buy" | "sell";
  base: number;
  quote: number;
  price: number;
  flow: Flow;
  tipLamports: number;
  feeLamports: number;
  /** Swaps on tracked venues in the same transaction. */
  swapsInTx: number;
}

export function fillsFromBlock(txs: ParsedTx[], venues: Venue[] = VENUES, baseMint: string = MINTS.SOL, quoteMint: string = MINTS.USDC): ArbFill[] {
  const byProgram = new Map(venues.map((v) => [v.program, v]));
  const programs = new Set(byProgram.keys());
  const out: ArbFill[] = [];
  txs.forEach((tx, i) => {
    const swaps = extractSwaps(tx, programs, i);
    if (swaps.length === 0) return;
    const tip = tipLamports(tx);
    for (const s of swaps) {
      const o = orient(s, baseMint, quoteMint);
      if (!o) continue;
      out.push({
        signature: s.signature,
        slot: s.slot,
        txIndex: s.txIndex,
        blockTime: s.blockTime,
        venue: byProgram.get(s.program)!.name,
        program: s.program,
        trader: s.trader,
        ...o,
        flow: flowOf(ownerDeltas(tx, s.trader), o, baseMint, quoteMint),
        tipLamports: tip,
        feeLamports: tx.meta?.fee ?? 0,
        swapsInTx: swaps.length,
      });
    }
  });
  return out;
}

export interface ScanOptions {
  from: number;
  to: number;
  every?: number;
  concurrency?: number;
  onBlock?: (slot: number, fills: number) => void;
}

/** Every SOL-USDC fill on the tracked venues in a slot range, in chain order. */
export async function scan(rpc: Rpc, opts: ScanOptions): Promise<ArbFill[]> {
  const every = Math.max(1, opts.every ?? 1);
  const slots: number[] = [];
  for (let s = opts.from; s <= opts.to; s += 500_000) slots.push(...(await rpc.getBlocks(s, Math.min(opts.to, s + 499_999))));
  const picked = slots.filter((_, i) => i % every === 0);
  const perBlock = await pool(picked, opts.concurrency ?? 2, async (slot) => {
    const txs = await rpc.getBlock(slot);
    const fills = txs ? fillsFromBlock(txs) : [];
    opts.onBlock?.(slot, fills.length);
    return fills;
  });
  return perBlock.flat().sort((a, b) => a.slot - b.slot || a.txIndex - b.txIndex);
}
