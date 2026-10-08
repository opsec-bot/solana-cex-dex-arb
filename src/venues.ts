/**
 * Program IDs, each checked on mainnet by reading the owner of a known pool account.
 * Pool addresses for the prop AMMs came from LimeChain's pmm-sim config.
 */
export interface Venue {
  name: string;
  program: string;
  kind: "prop" | "open";
}

export const VENUES: Venue[] = [
  { name: "HumidiFi", program: "9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp", kind: "prop" },
  { name: "SolFi V2", program: "SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF", kind: "prop" },
  { name: "BisonFi", program: "BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi", kind: "prop" },
  { name: "Tessera V", program: "TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH", kind: "prop" },
  { name: "ZeroFi", program: "ZERor4xhbUycZ6gb9ntrhqscUcZmAbQDjEAtCf4hbZY", kind: "prop" },
  { name: "Obric V2", program: "obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y", kind: "prop" },
  { name: "Orca Whirlpools", program: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", kind: "open" },
  { name: "Raydium CLMM", program: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", kind: "open" },
  { name: "Meteora DLMM", program: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", kind: "open" },
];

export const VENUE_BY_PROGRAM = new Map(VENUES.map((v) => [v.program, v]));

export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
} as const;
