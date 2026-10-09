// One indexer pass. The same code serves the daily job (every wallet, a big time budget) and an
// on-demand sync for a single account (its wallets only, a few seconds). Everything it writes is
// idempotent and cursor-based, so passes can overlap, be cut short by the deadline, or be repeated.
import { query } from "../db.js";
import { NETWORKS } from "../networks.generated.js";
import { syncBridgeForAddress } from "./bridge.js";
import { snapshotAddress } from "./snapshots.js";
import { syncVault, type VaultSyncResult } from "./vault.js";

export interface RunOptions {
  /** Total wall-clock budget for the pass. */
  budgetMs: number;
  /** Limit to one account's wallets. Omit to index every linked wallet. */
  accountId?: string;
  /** How long the vault scan may run at the end of the pass. Defaults to whatever budget is left. */
  vaultMs?: number;
  /** Ignore the per-wallet bridge throttle. */
  force?: boolean;
}

export interface RunSummary {
  wallets: number;
  bridge: { addresses: number; fetched: number; changed: number; skipped: number };
  snapshots: { inserted: number };
  vault: VaultSyncResult[];
  errors: string[];
  tookMs: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/** The addresses an account is known by: its EVM addresses, Solana keys, and each Solana key's Rome synthetic address. */
export async function addressesOf(accountId?: string): Promise<{ wallets: number; all: string[]; evmSide: string[] }> {
  const rows = accountId
    ? await query(`select kind, address, synthetic_address from wallets where account_id = $1`, [accountId])
    : await query(`select kind, address, synthetic_address from wallets`);
  const all = new Set<string>();
  const evmSide = new Set<string>(); // addresses that exist as accounts inside Rome's EVM
  for (const r of rows) {
    all.add(r.address);
    if (r.kind === "evm") evmSide.add(r.address);
    if (r.synthetic_address) {
      all.add(r.synthetic_address);
      evmSide.add(r.synthetic_address);
    }
  }
  return { wallets: rows.length, all: [...all], evmSide: [...evmSide] };
}

export async function runIndexer(opts: RunOptions): Promise<RunSummary> {
  const started = Date.now();
  const deadline = started + opts.budgetMs;
  const errors: string[] = [];
  const { wallets, all, evmSide } = await addressesOf(opts.accountId);

  // 1. Per-wallet work first: it is quick, and it's what a user is waiting on.
  const bridge = { addresses: all.length, fetched: 0, changed: 0, skipped: 0 };
  await mapLimit(all, 4, async (addr) => {
    if (Date.now() >= deadline) return;
    try {
      const r = await syncBridgeForAddress(addr, { force: opts.force });
      bridge.fetched += r.fetched;
      bridge.changed += r.changed;
      if (r.skipped) bridge.skipped++;
    } catch (e: any) {
      errors.push(`bridge ${addr.slice(0, 10)}…: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  });

  const snapshots = { inserted: 0 };
  await mapLimit(evmSide, 4, async (addr) => {
    if (Date.now() >= deadline) return;
    const r = await snapshotAddress(addr, NETWORKS);
    snapshots.inserted += r.inserted;
    errors.push(...r.errors);
  });

  // 2. Then the chain-wide Vault scan, with whatever time remains.
  const vault: VaultSyncResult[] = [];
  const vaultDeadline = Math.min(deadline, Date.now() + (opts.vaultMs ?? opts.budgetMs));
  for (const net of NETWORKS) {
    if (Date.now() >= vaultDeadline) break;
    try {
      const r = await syncVault(net, { deadline: vaultDeadline });
      if (r) {
        vault.push(r);
        if (r.backfill?.error) errors.push(`vault backfill ${net.chainName}: ${r.backfill.error}`);
      }
    } catch (e: any) {
      errors.push(`vault ${net.chainName}: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  return { wallets, bridge, snapshots, vault, errors, tookMs: Date.now() - started };
}
