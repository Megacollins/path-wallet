// Run the Vault history backfill to completion from your own machine, with live progress, then reconcile
// the result against the contract's own totalDeposits(). Rome's RPC serves roughly 20-35k blocks/second, so
// a month of history takes several minutes: far more than a serverless function's time limit.
//
//   npm run backfill -- --from 477000000                 # local dev database (.data/pglite)
//   npm run backfill -- --from 477000000 --yes           # with DATABASE_URL in .env this writes to Neon
//
// --from  first block to read (a little before the Vault's first activity). Or set INDEXER_VAULT_FROM_BLOCK_<chainId>.
// --chain chain id (default: every chain that has a Vault)
// --yes   required when DATABASE_URL points at a real database: it will insert rows.
import "dotenv/config";
import { NETWORKS } from "../api/_lib/networks.generated.js";
import { query } from "../api/_lib/db.js";
import { rpc } from "../api/_lib/indexer/rpc.js";
import { syncVault } from "../api/_lib/indexer/vault.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const yes = process.argv.includes("--yes");
const only = arg("chain") ? Number(arg("chain")) : null;
const from = arg("from");

const nets = NETWORKS.filter((n) => n.vault && (only === null || n.chainId === only));
if (!nets.length) {
  console.error("No chain with a Vault matches.");
  process.exit(1);
}
for (const n of nets) {
  if (from) process.env[`INDEXER_VAULT_FROM_BLOCK_${n.chainId}`] = from;
  if (!process.env[`INDEXER_VAULT_FROM_BLOCK_${n.chainId}`]) {
    console.error(`Give the start block: --from <block>, or set INDEXER_VAULT_FROM_BLOCK_${n.chainId}.`);
    process.exit(1);
  }
}

// Decide from the environment alone, BEFORE touching any database: opening one also applies migrations.
const remote = Boolean(process.env.DATABASE_URL?.trim());
if (remote && !yes) {
  console.error("DATABASE_URL is set, so this would write indexed events to that real database.\nRe-run with --yes to proceed.");
  process.exit(1);
}
console.log(`database: ${remote ? "the one in DATABASE_URL" : "local dev database (.data/pglite)"}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => n.toLocaleString("en-US");

for (const net of nets) {
  const start = Number(process.env[`INDEXER_VAULT_FROM_BLOCK_${net.chainId}`]);
  console.log(`\n${net.chainName}: vault ${net.vault}, backfilling from block ${fmt(start)}`);
  const t0 = Date.now();
  let failures = 0;
  let events = 0;
  for (;;) {
    try {
      const r = await syncVault(net, { deadline: Date.now() + 30_000 });
      failures = 0;
      const b = r?.backfill;
      if (!b) {
        console.log("  nothing to backfill (the start block is inside the range already scanned going forward)");
        break;
      }
      if (b.error) throw new Error(b.error);
      events += b.events;
      const pct = b.end > start ? Math.min(100, ((b.to - start + 1) / (b.end - start + 1)) * 100) : 100;
      const secs = (Date.now() - t0) / 1000;
      const rate = (b.to - start + 1) / Math.max(1, secs);
      const eta = b.done ? 0 : (b.end - b.to) / Math.max(1, rate);
      console.log(`  block ${fmt(b.to)} of ${fmt(b.end)}  ${pct.toFixed(1)}%  events ${events}  ${secs.toFixed(0)}s elapsed${b.done ? "" : `, ~${Math.ceil(eta / 60)} min left`}`);
      if (b.done) break;
    } catch (e: any) {
      failures++;
      console.log(`  round failed (${failures}/12): ${String(e?.message ?? e).slice(0, 120)}`);
      if (failures >= 12) {
        console.error("Giving up after 12 failed rounds in a row. Progress is saved: run the same command again to resume.");
        process.exit(1);
      }
      await sleep(Math.min(60_000, 3000 * failures)); // patient: a flaky link usually recovers within a minute or two
    }
  }

  // Reconcile: deposits minus withdrawals in our table must equal the contract's own running total,
  // *if* the range covers the Vault's whole life. A difference means history before --from is missing.
  const rows = await query(`select kind, count(*)::int as n, coalesce(sum(amount), 0)::text as total from chain_events where source = 'vault' and chain_id = $1 group by kind`, [net.chainId]);
  const sum = (k: string) => BigInt(String(rows.find((r) => r.kind === k)?.total ?? "0").split(".")[0]);
  const net_ = sum("vault_deposit") - sum("vault_withdraw");
  const onchain = BigInt(await rpc<string>(net.proxyUrl, "eth_call", [{ to: net.vault, data: "0x7d882097" }, "latest"])); // totalDeposits()
  console.log(`\n  indexed: ${rows.map((r) => `${r.n} ${String(r.kind).replace("vault_", "")}s`).join(", ") || "no events"}`);
  console.log(`  deposits - withdrawals = ${net_} wUSDC base units | contract totalDeposits() = ${onchain}`);
  console.log(net_ === onchain ? "  RECONCILED: the indexed history accounts for every unit in the Vault." : "  NOT RECONCILED: some history is missing (start earlier with --from), or activity happened in the last few blocks.");
}
process.exit(0);
