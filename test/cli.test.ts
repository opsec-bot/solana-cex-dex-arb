import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { klinesToPoints, PriceSeries } from "../src/prices.js";
import { fillsFromBlock } from "../src/scan.js";

const run = (...args: string[]) =>
  execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("cli report", () => {
  it("reports on real fills with real Binance prices", () => {
    const block = JSON.parse(readFileSync("test/fixtures/block-454653033.json", "utf8"));
    const txs = block.transactions.map(({ tx }: { tx: object }) => ({ ...tx, slot: block.slot, blockTime: block.blockTime }));
    const dir = mkdtempSync(join(tmpdir(), "arb-"));
    writeFileSync(join(dir, "fills.jsonl"), fillsFromBlock(txs).map((f) => JSON.stringify(f)).join("\n") + "\n");
    const rows = JSON.parse(readFileSync("test/fixtures/binance-SOLUSDC-1s.json", "utf8"));
    writeFileSync(join(dir, "prices.json"), JSON.stringify(new PriceSeries(klinesToPoints(rows))));
    const report = JSON.parse(run("report", join(dir, "fills.jsonl"), join(dir, "prices.json"), "--json"));
    expect(report.fills).toBeGreaterThan(0);
    expect(report.options).toEqual({ hedgeDelaySec: 0, minEdgeBps: 0, minTrades: 3 });
    expect(run("report", join(dir, "fills.jsonl"), join(dir, "prices.json"))).toContain("| Venue | Fills |");
  }, 30_000);
});
