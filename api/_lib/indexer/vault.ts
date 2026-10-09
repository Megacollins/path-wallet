// Vault events (Deposited / Withdrawn), scanned chain-wide with a resumable cursor.
//
// Why chain-wide instead of per wallet: the log filter is cheap, it needs no list of wallets, and a
// wallet linked next month is credited with deposits it made last week without any re-scan.
//
// Correctness rules:
//  • Pages are fetched in parallel batches, but the cursor only advances past a batch in which EVERY page
//    succeeded. A failed page leaves the cursor where it was, so history never gets a hole.
//  • Inserts are idempotent (unique source/chain/tx:logIndex), so overlapping runs or retries are harmless.
//  • The newest CONFIRMATIONS blocks are left for the next run, so a reorg can't leave a phantom event.
//  • If the node reports a smaller max range than our page size, we adopt it and carry on.
import { query } from "../db.js";
import type { IndexedNetwork } from "../networks.generated.js";
import { RpcError, hexToNum, numToHex, rpc } from "./rpc.js";
import { advanceCursor, getState } from "./state.js";

export const DEPOSITED = "0x2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c4"; // Deposited(address,uint256)
export const WITHDRAWN = "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5"; // Withdrawn(address,uint256)
export const CONFIRMATIONS = 30;
const CONCURRENCY = 8;
const DEFAULT_PAGE = 10_000; // Rome's proxy allows 12,000 per eth_getLogs; stay under it
const DEFAULT_LOOKBACK = 1_000_000; // first run: ~66 hours of history (Rome makes ~4 blocks/second)

interface RawLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  data: string;
}

export interface VaultSyncResult {
  chainId: number;
  from: number;
  to: number;
  events: number;
  caughtUp: boolean;
  pageSize: number;
}

async function fetchPage(net: IndexedNetwork, from: number, to: number): Promise<RawLog[]> {
  // Log queries on Rome's RPC are slow and uneven (1–8 s for identical pages), so give them room.
  return rpc<RawLog[]>(net.proxyUrl, "eth_getLogs", [{ address: net.vault, fromBlock: numToHex(from), toBlock: numToHex(to), topics: [[DEPOSITED, WITHDRAWN]] }], { timeoutMs: 25_000, retries: 1 });
}

/** One batch of pages, in parallel. If that fails for any reason other than a range limit, the same pages
 *  are retried one at a time (parallel load is the usual cause of a stall); a second failure propagates. */
async function fetchBatch(net: IndexedNetwork, ranges: [number, number][]): Promise<RawLog[]> {
  try {
    return (await Promise.all(ranges.map(([f, t]) => fetchPage(net, f, t)))).flat();
  } catch (e) {
    if (e instanceof RpcError && e.maxRange) throw e;
    const out: RawLog[] = [];
    for (const [f, t] of ranges) out.push(...(await fetchPage(net, f, t)));
    return out;
  }
}

async function blockTimes(net: IndexedNetwork, blocks: number[]): Promise<Map<number, Date>> {
  const out = new Map<number, Date>();
  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    await Promise.all(
      blocks.slice(i, i + CONCURRENCY).map(async (b) => {
        const blk = await rpc<{ timestamp: string } | null>(net.proxyUrl, "eth_getBlockByNumber", [numToHex(b), false]);
        if (blk?.timestamp) out.set(b, new Date(hexToNum(blk.timestamp) * 1000));
      }),
    );
  }
  return out;
}

async function store(net: IndexedNetwork, logs: RawLog[]): Promise<number> {
  if (!logs.length) return 0;
  const times = await blockTimes(net, [...new Set(logs.map((l) => hexToNum(l.blockNumber)))]);
  let inserted = 0;
  for (const l of logs) {
    const deposit = l.topics[0]?.toLowerCase() === DEPOSITED;
    const block = hexToNum(l.blockNumber);
    const rows = await query(
      `insert into chain_events (source, kind, chain_id, address, amount, asset, external_id, occurred_at, data)
       values ('vault', $1, $2, $3, $4, 'wusdc', $5, $6, $7::jsonb)
       on conflict (source, chain_id, external_id) do nothing
       returning id`,
      [
        deposit ? "vault_deposit" : "vault_withdraw",
        net.chainId,
        "0x" + (l.topics[1] ?? "").slice(-40).toLowerCase(),
        BigInt(l.data).toString(), // uint256 amount, wUSDC base units (6 decimals)
        `${l.transactionHash.toLowerCase()}:${hexToNum(l.logIndex)}`,
        times.get(block) ?? null,
        JSON.stringify({ block, tx: l.transactionHash, vault: net.vault }),
      ],
    );
    inserted += rows.length;
  }
  return inserted;
}

export async function syncVault(net: IndexedNetwork, opts: { deadline: number }): Promise<VaultSyncResult | null> {
  if (!net.vault) return null;
  const key = `vault:${net.chainId}`;
  const saved = await getState<{ next: number; page?: number }>(key);
  const head = hexToNum(await rpc(net.proxyUrl, "eth_blockNumber", []));
  const safe = head - CONFIRMATIONS;
  let page = saved?.page ?? DEFAULT_PAGE;

  let next = saved?.next;
  if (next == null) {
    // First run for this chain: an explicit start block wins; otherwise a bounded lookback. (Rome's RPC
    // answers eth_getCode for any block with the latest state, so the deployment block can't be found by search.)
    const explicit = Number(process.env[`INDEXER_VAULT_FROM_BLOCK_${net.chainId}`]);
    const lookback = Number(process.env.INDEXER_LOOKBACK_BLOCKS) || DEFAULT_LOOKBACK;
    next = Number.isFinite(explicit) && process.env[`INDEXER_VAULT_FROM_BLOCK_${net.chainId}`] ? explicit : Math.max(0, safe - lookback);
  }

  const from = next;
  let events = 0;
  while (next <= safe && Date.now() < opts.deadline) {
    const ranges: [number, number][] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const f = next + i * page;
      if (f > safe) break;
      ranges.push([f, Math.min(f + page - 1, safe)]);
    }
    let logs: RawLog[];
    try {
      logs = await fetchBatch(net, ranges);
    } catch (e) {
      // The node told us its limit is below our page size: adopt it and redo this batch narrower.
      if (e instanceof RpcError && e.maxRange && e.maxRange < page) {
        page = e.maxRange;
        continue;
      }
      throw e; // anything else: keep the cursor where it is, retry next run
    }
    events += await store(net, logs);
    next = ranges[ranges.length - 1][1] + 1;
    await advanceCursor(key, { next, page });
  }
  return { chainId: net.chainId, from, to: next - 1, events, caughtUp: next > safe, pageSize: page };
}
