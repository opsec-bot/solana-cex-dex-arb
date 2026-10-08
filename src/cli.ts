#!/usr/bin/env -S npx tsx
import { readFileSync } from "node:fs";
import { buildReport, toMarkdown } from "./arb.js";
import { fetchBinanceSeconds, PriceSeries } from "./prices.js";
import { Rpc } from "./rpc.js";
import { scan, type ArbFill } from "./scan.js";

const USAGE = `Usage:
  arb scan --rpc <url> --from <slot> --to <slot> [--every N] [--concurrency N]   > fills.jsonl
  arb scan --rpc <url> --last <blocks> [--every N]                               > fills.jsonl
  arb prices [--pair SOLUSDC] [--pad 60] <fills.jsonl>                            > prices.json
  arb report <fills.jsonl> <prices.json> [--hedge-delay 0] [--min-edge 0] [--min-trades 3] [--json]`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function bool(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

const readFills = (path: string): ArbFill[] =>
  readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ArbFill);

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === "scan") {
    const url = flag(args, "--rpc") ?? process.env.SOLANA_RPC_URL;
    if (!url) return usage();
    const rpc = new Rpc(url);
    const last = flag(args, "--last");
    let from = Number(flag(args, "--from"));
    let to = Number(flag(args, "--to"));
    if (last) {
      to = await rpc.getSlot();
      from = to - Number(last) + 1;
    }
    if (!Number.isFinite(from) || !Number.isFinite(to)) return usage();
    let blocks = 0;
    let total = 0;
    const fills = await scan(rpc, {
      from,
      to,
      every: Number(flag(args, "--every") ?? 1),
      concurrency: Number(flag(args, "--concurrency") ?? 2),
      onBlock: (_s, n) => {
        blocks++;
        total += n;
        process.stderr.write(`\rblocks ${blocks}, fills ${total}`);
      },
    });
    process.stderr.write("\n");
    for (const f of fills) process.stdout.write(JSON.stringify(f) + "\n");
    return 0;
  }
  if (cmd === "prices") {
    const pair = flag(args, "--pair") ?? "SOLUSDC";
    const pad = Number(flag(args, "--pad") ?? 60);
    if (!args[0]) return usage();
    const times = readFills(args[0]).map((f) => f.blockTime);
    if (times.length === 0) throw new Error("no fills");
    const series = await fetchBinanceSeconds(pair, Math.min(...times) - 5, Math.max(...times) + pad);
    process.stdout.write(JSON.stringify(series) + "\n");
    return 0;
  }
  if (cmd === "report") {
    const hedgeDelaySec = Number(flag(args, "--hedge-delay") ?? 0);
    const minEdgeBps = Number(flag(args, "--min-edge") ?? 0);
    const minTrades = Number(flag(args, "--min-trades") ?? 3);
    const json = bool(args, "--json");
    if (!args[0] || !args[1]) return usage();
    const prices = new PriceSeries(JSON.parse(readFileSync(args[1], "utf8")));
    const report = buildReport(readFills(args[0]), prices, { hedgeDelaySec, minEdgeBps, minTrades });
    process.stdout.write((json ? JSON.stringify(report, null, 2) : toMarkdown(report)) + "\n");
    return 0;
  }
  return usage();
}

function usage(): number {
  process.stderr.write(USAGE + "\n");
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
