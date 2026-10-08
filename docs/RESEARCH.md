# Research notes

Read October 2026.

## The Ethereum study we port
Wu, Sui, Thiery, Pai, *Measuring CEX-DEX Extracted Value and Searcher Profitability: The Darkest of the MEV Dark
Forest*, [arXiv:2507.13023](https://arxiv.org/abs/2507.13023), AFT 2025
([Ethereum RIG summary](https://rig.ethereum.org/paper/measuring-cex-dex-extracted-value-and-searcher-profitability-the-darkest-of-the-mev-dark-forest)).
- Builds heuristics to pick CEX-DEX arbitrage out of on-chain swaps, then estimates the CEX leg from public prices
  without seeing the searcher's CEX trades.
- August 2023 to March 2025: about $233.8M extracted over 7.2M arbitrages by 19 searchers. Three searchers took about
  three quarters of volume and value.

## Solana
- We found no population-level study of CEX-DEX arbitrage on Solana. Searches returned single-transaction case studies
  (EigenPhi on [triangular arbitrage through Jito](https://eigenphi.substack.com/p/solanas-triangular-arbitrage-explored))
  and bot marketing.
- Solana differs from Ethereum in ways that matter here:
  - No public mempool and 0.4 s blocks, so arbitrage competes on latency and Jito tips, not gas auctions.
  - Prop AMMs (HumidiFi, BisonFi and others) now hold most SOL-USDC volume and update quotes many times a second,
    which should shrink the CEX-DEX gap on those venues. This tool shows whether it does.
- Jito tip accounts: the eight addresses come from the block engine's public `getTipAccounts` call, checked
  2026-10-08.

## Our heuristics vs Wu et al.
Wu et al. require the swap to go the way of the price gap, and filter by searcher identity and transaction shape. We
use the same ideas, adapted:
- direction and edge against Binance at the hedge time
- transaction shape from the trader's net balance change, which also separates atomic on-chain cycles cleanly without a
  list of every DEX program
- searcher identity from Jito tips or repeat trading
