# solana-cex-dex-arb

Who arbitrages Binance against Solana pools, how much they make, and which pools pay for it.

On Ethereum, CEX-DEX arbitrage has been measured: about $234M over 19 months, with three searchers taking three
quarters of it (Wu, Sui, Thiery, Pai, AFT 2025). We found no such measurement for Solana. This tool does it from public
data: Solana blocks and Binance's public 1 second prices.

## How it works
1. **Scan blocks.** Every SOL-USDC fill on nine venues (six prop AMMs, Orca, Raydium CLMM, Meteora DLMM) is read straight
   from the token transfers each pool makes, no IDL needed.
2. **Look at the whole transaction.** For each fill, take the trader's net balance change for the transaction:
   - SOL and USDC moved opposite ways and nothing else moved: **directional**, one leg of a cross-venue trade.
   - Neither moved much because the fill was undone in the same transaction: **cycle**, an atomic on-chain arbitrage.
   - Anything else (routes into other tokens, transfers out): **other**.
3. **Classify.** A fill is CEX-DEX if it is directional, beat the Binance mid at the hedge time, and the trader looks
   like a searcher (paid a Jito tip, or made 3 or more such fills).
4. **Price the hidden leg.** The searcher is assumed to hedge on Binance at the mid, at the fill's second plus a delay.
   Profit = `s (base * mid - quote)` minus tip and fee.
5. **Aggregate.** Totals, per-searcher profit, concentration (HHI, top 1/3/10 share, Gini) and, per venue, how much of
   its volume was CEX-DEX arbitrage.

Details in [docs/SPEC.md](docs/SPEC.md), sources in [docs/RESEARCH.md](docs/RESEARCH.md).

## Try it
Needs Node 22 or newer.

```sh
npm install
npm test

npx tsx src/cli.ts scan --rpc https://api.mainnet-beta.solana.com --last 600 --every 15 --concurrency 1 > fills.jsonl
npx tsx src/cli.ts prices fills.jsonl > prices.json
npx tsx src/cli.ts report fills.jsonl prices.json
```

Options for `report`: `--hedge-delay <s>`, `--min-edge <bps>`, `--min-trades <n>`, `--json`.

[docs/sample-2026-10-08.md](docs/sample-2026-10-08.md) shows a 40 block run. It is a demo of the format; use your
own RPC and a few hours of blocks for real numbers.

## Limits
- The Binance leg is a model. A searcher who hedged later or not at all made a different profit.
- Binance taker fees are not subtracted.
- One searcher spread across many untipped wallets looks like several small traders, so concentration can be
  understated.
- With `--every N`, totals cover the sampled blocks only. Multiply by N for the whole window.

## License
MIT
