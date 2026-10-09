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
//  • History from before the first forward scan is filled by an opt-in backfill on its own cursor (see backfill()).
import { query } from "../db.js";
import type { IndexedNetwork } from "../networks.generated.js";
import { RpcError, hexToNum, numToHex, rpc } from "./rpc.js";
import { advanceCursor, createState, getState, setState } from "./state.js";

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
  /** Present when a historical backfill is configured for this chain. */
  backfill?: { from: number; to: number; end: number; events: number; done: boolean; error?: string };
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

/** Scan cursor persisted in indexer_state. */
interface Cursor {
  next: number;
  page?: number;
  /** Forward cursor: the block its very first scan started at (everything after it is covered going forward). */
  origin?: number;
  /** Backfill cursor: the inclusive range being filled, and whether it is finished. */
  from?: number;
  end?: number;
  done?: boolean;
}

interface ScanResult {
  from: number;
  to: number;
  events: number;
  done: boolean;
  page: number;
}

/**
 * Scan [cursor.next .. limit] in batches, saving the cursor after every fully-successful batch. Shared by
 * the forward scan (limit = newest safe block) and the backfill (limit = the end of the historical range).
 */
async function scan(net: IndexedNetwork, key: string, cursor: Cursor, limit: number, deadline: number): Promise<ScanResult> {
  let next = cursor.next;
  let page = cursor.page ?? DEFAULT_PAGE;
  const from = next;
  let events = 0;
  while (next <= limit && Date.now() < deadline) {
    const ranges: [number, number][] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const f = next + i * page;
      if (f > limit) break;
      ranges.push([f, Math.min(f + page - 1, limit)]);
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
    await advanceCursor(key, { ...cursor, next, page, ...(cursor.end !== undefined ? { done: next > limit } : {}) });
  }
  return { from, to: next - 1, events, done: next > limit, page };
}

/**
 * Fill in history from before the forward scan began. Opt-in: set INDEXER_VAULT_FROM_BLOCK_<chainId> to the
 * block to start from (a little before the Vault's first activity). It runs on its own cursor, after the
 * forward scan, with whatever time is left; overlap with already-scanned blocks is harmless (idempotent).
 * Lowering the start block later scans only the newly uncovered part.
 */
async function backfill(net: IndexedNetwork, forward: Cursor, deadline: number): Promise<VaultSyncResult["backfill"]> {
  const raw = process.env[`INDEXER_VAULT_FROM_BLOCK_${net.chainId}`]?.trim();
  const start = raw ? Number(raw) : NaN;
  if (!Number.isInteger(start) || start < 0) return undefined;

  // Everything from here on is already covered by the forward scan.
  const origin = forward.origin ?? forward.next;
  if (start >= origin) return undefined;

  const key = `vault-backfill:${net.chainId}`;
  let state = await getState<Cursor>(key);
  if (!state || state.from == null || state.end == null) {
    // Created, never overwritten: if an overlapping run got there first, carry on from its progress.
    state = await createState<Cursor>(key, { from: start, end: origin, next: start, done: false });
  } else if (start < state.from) {
    // A deeper start was requested after a previous backfill. If that one finished, only the gap is new;
    // if it was still running, redo from the new start (the already-scanned part is re-read, harmlessly).
    // This is a deliberate rewind, so it bypasses the never-backwards guard that protects normal progress.
    state = state.done ? { from: start, end: state.from - 1, next: start, done: false } : { ...state, from: start, next: start };
    await setState(key, state);
  }
  if (state.done) return { from: state.from!, to: state.end!, end: state.end!, events: 0, done: true };

  const r = await scan(net, key, state, state.end!, deadline);
  return { from: r.from, to: r.to, end: state.end!, events: r.events, done: r.done };
}

export async function syncVault(net: IndexedNetwork, opts: { deadline: number }): Promise<VaultSyncResult | null> {
  if (!net.vault) return null;
  const key = `vault:${net.chainId}`;
  const head = hexToNum(await rpc(net.proxyUrl, "eth_blockNumber", []));
  const safe = head - CONFIRMATIONS;

  let forward = await getState<Cursor>(key);
  if (forward?.next == null) {
    // First run for this chain: a bounded lookback. (Rome's RPC answers eth_getCode for any block with the
    // latest state, so the deployment block can't be found by search; older history is the backfill's job.)
    const lookback = Number(process.env.INDEXER_LOOKBACK_BLOCKS) || DEFAULT_LOOKBACK;
    const start = Math.max(0, safe - lookback);
    forward = { next: start, origin: start };
  }

  const f = await scan(net, key, forward, safe, opts.deadline);
  const result: VaultSyncResult = { chainId: net.chainId, from: f.from, to: f.to, events: f.events, caughtUp: f.done, pageSize: f.page };

  // The backfill must never take the fresh data down with it: report its failure, keep the forward result.
  try {
    const b = await backfill(net, forward, opts.deadline);
    if (b) result.backfill = b;
  } catch (e: any) {
    result.backfill = { from: 0, to: 0, end: 0, events: 0, done: false, error: String(e?.message ?? e).slice(0, 160) };
  }
  return result;
}
