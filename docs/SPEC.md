# Spec: solana-cex-dex-arb v1

## Goal
Measure CEX-DEX arbitrage on Solana: who trades the gap between Binance and Solana pools, how much they make, how
concentrated it is, and which pools they pick off. Wu, Sui, Thiery and Pai did this for Ethereum (AFT 2025). We
found no Solana version.

## What we can see
Only the on-chain leg. The Binance leg is invisible, so like Wu et al. we estimate it: the searcher is assumed to hedge
at the Binance mid at the fill's second plus a hedge delay (default 0 s).

## Pipeline
1. Scan blocks (`getBlock`, jsonParsed, transaction version 1). For every SOL-USDC fill on the tracked venues (same
   verified list as prop-amm-markouts: six prop AMMs, Orca, Raydium CLMM, Meteora DLMM), record:
   - the fill (side, base, quote, price, venue, trader, slot, position in block)
   - **flow**: the trader's net balance change for the whole transaction, SOL (native plus wrapped) and every token
     account the trader owns:
     - `directional`: SOL and USDC moved in opposite directions, nothing else moved. One leg of a cross-venue trade.
     - `cycle`: the trader ended with more of one token and nothing else changed. An atomic on-chain arbitrage.
     - `other`: anything else (multi-token routes, transfers out).
   - **tip**: lamports sent to the eight Jito tip accounts (list fetched from the block engine's `getTipAccounts`)
   - **fee**: the transaction fee, base plus priority
2. Fetch Binance 1 second closes for the covered window.

## Classification
A fill is **CEX-DEX** when all hold:
- flow is `directional`
- the fill beat the Binance mid at the hedge time by more than `minEdgeBps` (default 0): `edge = s (m_hedge - p) / p > min`
- the trader looks like a searcher: paid a Jito tip, or made at least `minTrades` (default 3) such fills in the data

Fills with flow `cycle` are counted as **atomic** arbitrage, separately.

## Profit
For a CEX-DEX fill with side `s`, base `b`, quote `q`, mid `m` at the hedge time:
- gross = `s (b m - q)` in quote (buy: base is worth `b m` on Binance, it cost `q`)
- costs = (tip + fee) in SOL times `m`
- net = gross - costs

Binance taker fees are not subtracted (searchers at this level pay close to zero), and we say so in the output.

## Aggregates
- Totals: fills, CEX-DEX fills, atomic fills, volume, gross, costs, net.
- Per searcher: fills, volume, net, tips, share of total net.
- Concentration over searchers' net profit: HHI, top 1 / 3 / 10 share, Gini.
- Per venue: fills, volume, CEX-DEX share of volume, net taken by arbitrageurs from that venue.

## CLI
```
arb scan --rpc <url> --last <blocks> [--every N] > fills.jsonl
arb prices fills.jsonl > prices.json
arb report fills.jsonl prices.json [--hedge-delay 0] [--min-edge 0] [--min-trades 3] [--json]
```

## Known weaknesses
- Hedge price is a model. A searcher who hedged later, or not at all, made a different profit.
- `blockTime` is 1 second resolution.
- A searcher who splits flow across many wallets with no tips looks like several small traders. Concentration is then
  understated.
- Sampled blocks (`--every N`) give totals for the sample only. Scale by N for an estimate of the whole window.
