// Indexer tests against an in-memory Postgres (PGlite), with the chain RPC and the bridge API mocked so
// every failure mode can be forced. The properties that matter most: history has no gaps and no
// duplicates however a run ends (deadline, failed page, overlapping runs), and each account only ever
// sees its own wallets' events.
//   npm run test:indexer
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;
delete process.env.CRON_SECRET;
process.env.INDEXER_LOOKBACK_BLOCKS = "100000";

import { NETWORKS } from "../api/_lib/networks.generated.js";
import { query } from "../api/_lib/db.js";
import { startSession } from "../api/_lib/auth.js";
import { advanceCursor, getState } from "../api/_lib/indexer/state.js";
import { CONFIRMATIONS, DEPOSITED, WITHDRAWN, syncVault } from "../api/_lib/indexer/vault.js";
import { syncBridgeForAddress } from "../api/_lib/indexer/bridge.js";
import { snapshotAddress } from "../api/_lib/indexer/snapshots.js";
import { runIndexer } from "../api/_lib/indexer/run.js";
import * as sync from "../api/account/sync.js";
import * as activity from "../api/account/activity.js";
import * as cron from "../api/cron/index.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

/* --------------------------------------------------------------- mocks */
const HADRIAN = NETWORKS.find((n) => n.vault)!;
const MARTIUS = NETWORKS.find((n) => !n.vault)!;
const T0 = 1_700_000_000;

interface MockLog { block: number; index: number; kind: "dep" | "wd"; who: string; amount: bigint; tx: string }
const chain = {
  head: 1_000_000,
  maxRange: 12_000,
  logs: [] as MockLog[],
  calls: [] as { from: number; to: number }[],
  failFrom: new Set<number>(), // pages starting at these blocks fail persistently (HTTP 500)
  latencyMs: 0,
  inflight: 0,
  failWhenConcurrent: false, // pages fail while another page is in flight (a node that chokes on parallel load)
  nonces: new Map<string, number>(),
  balances: new Map<string, bigint>(),
};
const bridge = { transfers: new Map<string, any[]>(), calls: [] as string[], fail: false };

const hex = (n: number | bigint) => "0x" + n.toString(16);
const pad32 = (h: string) => "0x" + h.replace(/^0x/, "").padStart(64, "0");

globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (url.startsWith(HADRIAN.proxyUrl) || url.startsWith(MARTIUS.proxyUrl)) {
    const host = new URL(url).host;
    const { method, params } = JSON.parse(init.body);
    if (method === "eth_blockNumber") return json({ result: hex(chain.head) });
    if (method === "eth_getBlockByNumber") return json({ result: { timestamp: hex(T0 + Number(BigInt(params[0]))) } });
    if (method === "eth_getTransactionCount") return json({ result: hex(chain.nonces.get(`${host}:${params[0].toLowerCase()}`) ?? 0) });
    if (method === "eth_getBalance") return json({ result: hex(chain.balances.get(`${host}:${params[0].toLowerCase()}`) ?? 0n) });
    if (method === "eth_getLogs") {
      const f = params[0];
      const from = Number(BigInt(f.fromBlock));
      const to = Number(BigInt(f.toBlock));
      chain.calls.push({ from, to });
      chain.inflight++;
      if (chain.latencyMs) await new Promise((r) => setTimeout(r, chain.latencyMs));
      const concurrent = chain.inflight > 1;
      chain.inflight--;
      if (chain.failWhenConcurrent && concurrent) return json({}, 500);
      if (chain.failFrom.has(from)) return json({}, 500);
      const range = to - from + 1;
      if (range > chain.maxRange) return json({ error: { code: -32005, message: `eth_getLogs block range too wide: ${range} blocks requested, max ${chain.maxRange} – paginate the query` } });
      return json({
        result: chain.logs
          .filter((l) => l.block >= from && l.block <= to)
          .map((l) => ({ blockNumber: hex(l.block), logIndex: hex(l.index), transactionHash: pad32(l.tx), topics: [l.kind === "dep" ? DEPOSITED : WITHDRAWN, pad32(l.who)], data: pad32(hex(l.amount)) })),
      });
    }
    return json({ error: { code: -32601, message: "method not found" } });
  }
  if (url.startsWith("https://bridge-api.devnet.romeprotocol.xyz/v1/transfers")) {
    const addr = new URL(url).searchParams.get("address")!;
    bridge.calls.push(addr);
    if (bridge.fail) return json({ error: "boom" }, 500);
    return json({ transfers: bridge.transfers.get(addr) ?? [] });
  }
  throw new Error("unexpected fetch: " + url);
}) as typeof fetch;

const BF_ENV = `INDEXER_VAULT_FROM_BLOCK_${HADRIAN.chainId}`;
const ADDR = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const SOLANA = "BCeG8VUWnQ2RcsYFbotaYSivrE8RraTQEtAwcATMj389";
const SYNTH = "0xc5e4a7b03a2c01328770ee964f211e91b08a73a8";
const FAR = () => Date.now() + 60_000;
const safeOf = () => chain.head - CONFIRMATIONS;
let txn = 0;
const log = (block: number, kind: "dep" | "wd", who: string, amount: bigint): MockLog => ({ block, index: block % 7, kind, who, amount, tx: String(++txn) });

async function reset() {
  for (const t of ["chain_events", "indexer_state", "wallet_snapshots", "sessions", "wallets", "accounts"]) await query(`delete from ${t}`);
  chain.head = 1_000_000;
  chain.maxRange = 12_000;
  chain.logs = [];
  chain.calls = [];
  chain.failFrom.clear();
  chain.latencyMs = 0;
  chain.inflight = 0;
  chain.failWhenConcurrent = false;
  chain.nonces.clear();
  chain.balances.clear();
  delete process.env[BF_ENV];
  bridge.transfers.clear();
  bridge.calls = [];
  bridge.fail = false;
}
const count = async (where = "true") => Number((await query(`select count(*)::int as n from chain_events where ${where}`))[0].n);

/* --------------------------------------------------------------- vault */
{
  await reset();
  // start = safe - lookback = 999_970 - 100_000 = 899_970
  chain.logs = [log(800_000, "dep", ADDR(1), 1n), log(900_000, "dep", ADDR(1), 5_000_000n), log(950_123, "wd", ADDR(1), 2_000_000n), log(999_000, "dep", ADDR(2), 7n), log(999_969, "dep", ADDR(3), 9n), log(999_980, "dep", ADDR(4), 11n)];
  const r = await syncVault(HADRIAN, { deadline: FAR() });
  check("vault: first run indexes the lookback window up to the confirmation margin", r?.events === 4 && (await count("source = 'vault'")) === 4, r);
  const row = (await query(`select kind, address, amount, occurred_at, chain_id from chain_events where address = $1 order by occurred_at`, [ADDR(1)]));
  check("vault: kind, address, amount (base units), block time and chain are decoded", row.length === 2 && row[0].kind === "vault_deposit" && row[0].amount === "5000000" && row[1].kind === "vault_withdraw" && new Date(row[0].occurred_at).getTime() === (T0 + 900_000) * 1000 && Number(row[0].chain_id) === HADRIAN.chainId, row);
  check("vault: nothing before the start block or inside the confirmation margin", (await count(`external_id like '%'`)) === 4 && (await count(`address = '${ADDR(4)}'`)) === 0);
  check("vault: pages are contiguous, non-overlapping and under the page size", chain.calls[0].from === 899_970 && chain.calls.every((c, i) => c.to - c.from + 1 <= 10_000 && (i === 0 || c.from > chain.calls[i - 1].from)) && Math.max(...chain.calls.map((c) => c.to)) === safeOf(), chain.calls.slice(0, 3));
  check("vault: cursor saved just past the safe head", (await getState<{ next: number }>(`vault:${HADRIAN.chainId}`))?.next === safeOf() + 1);

  chain.calls = [];
  const again = await syncVault(HADRIAN, { deadline: FAR() });
  check("vault: a repeat run at the same head does no scanning and adds nothing", again?.events === 0 && chain.calls.length === 0 && (await count("source = 'vault'")) === 4, again);

  chain.head = 1_000_500;
  chain.logs.push(log(1_000_100, "dep", ADDR(5), 1n), log(1_000_440, "wd", ADDR(5), 1n));
  chain.calls = [];
  const inc = await syncVault(HADRIAN, { deadline: FAR() });
  check("vault: next run resumes exactly at the cursor", chain.calls[0].from === 999_971, chain.calls[0]);
  check("vault: the earlier margin log and the new logs are picked up; nothing doubled", inc?.events === 3 && (await count("source = 'vault'")) === 7, inc);

  const [a, b] = await Promise.all([syncVault(HADRIAN, { deadline: FAR() }), syncVault(HADRIAN, { deadline: FAR() })]);
  check("vault: overlapping runs cannot create duplicates", (await count("source = 'vault'")) === 7, [a, b]);

  await advanceCursor(`vault:${HADRIAN.chainId}`, { next: 5 });
  check("vault: a slow older run cannot rewind the cursor", ((await getState<{ next: number }>(`vault:${HADRIAN.chainId}`))?.next ?? 0) > 1_000_000);
}

{
  await reset();
  chain.maxRange = 5_000; // the node allows less than our default page
  chain.logs = [log(900_500, "dep", ADDR(1), 1n), log(960_000, "dep", ADDR(2), 2n), log(999_900, "wd", ADDR(3), 3n)];
  const r = await syncVault(HADRIAN, { deadline: FAR() });
  check("vault: adopts a smaller block-range limit reported by the node and still captures everything", r?.pageSize === 5_000 && r.events === 3 && r.caughtUp, r);
  check("vault: the learned page size is remembered", (await getState<{ page: number }>(`vault:${HADRIAN.chainId}`))?.page === 5_000);
}

{
  await reset();
  chain.logs = [log(900_500, "dep", ADDR(1), 1n), log(999_900, "wd", ADDR(2), 2n)];
  chain.latencyMs = 20;
  chain.failWhenConcurrent = true;
  const r = await syncVault(HADRIAN, { deadline: FAR() });
  check("vault: if a parallel batch stalls, the same pages are retried one at a time and nothing is lost", r?.events === 2 && r.caughtUp === true && (await count("source = 'vault'")) === 2, r);
}

{
  await reset();
  // Several full batches (8 pages x 10,000 blocks = 80,000 blocks each) with a deadline that expires after the first.
  process.env.INDEXER_LOOKBACK_BLOCKS = "400000";
  const start = safeOf() - 400_000;
  chain.logs = [20_000, 90_000, 170_000, 250_000, 330_000, 399_000].map((o) => log(start + o, "dep", ADDR(7), BigInt(o)));
  chain.latencyMs = 30;
  const partial = await syncVault(HADRIAN, { deadline: Date.now() + 20 });
  const st = await getState<{ next: number }>(`vault:${HADRIAN.chainId}`);
  check("vault: a deadline stops after a whole batch and saves exactly that progress", partial !== null && !partial.caughtUp && st?.next === start + 80_000 && (await count()) === 1, { partial, st, start });
  chain.latencyMs = 0;
  const rest = await syncVault(HADRIAN, { deadline: FAR() });
  check("vault: the next run finishes the job: every log once, no gaps", rest?.caughtUp === true && (await count()) === 6, rest);
  process.env.INDEXER_LOOKBACK_BLOCKS = "100000";
}

{
  await reset();
  process.env.INDEXER_LOOKBACK_BLOCKS = "400000";
  const start = safeOf() - 400_000;
  chain.logs = [20_000, 100_000, 170_000, 250_000, 399_000].map((o) => log(start + o, "dep", ADDR(8), BigInt(o)));
  chain.failFrom.add(start + 80_000 + 30_000); // a page in the SECOND batch fails
  let threw = false;
  try {
    await syncVault(HADRIAN, { deadline: FAR() });
  } catch {
    threw = true;
  }
  const st = await getState<{ next: number }>(`vault:${HADRIAN.chainId}`);
  check("vault: a failed page aborts the run and leaves the cursor at the last fully-successful batch", threw && st?.next === start + 80_000 && (await count()) === 1, { threw, st, start });
  chain.failFrom.clear();
  await syncVault(HADRIAN, { deadline: FAR() });
  check("vault: after the failure clears, nothing was lost", (await count()) === 5, await count());
  process.env.INDEXER_LOOKBACK_BLOCKS = "100000";
}

/* ------------------------------------------------------------ backfill */
// Forward scan origin = safe - lookback = 999_970 - 100_000 = 899_970. The backfill fills [start .. origin].
const bfState = () => getState<{ next: number; from: number; end: number; done: boolean }>(`vault-backfill:${HADRIAN.chainId}`);
const blocksOf = async () => (await query(`select (data->>'block')::int as b from chain_events where source = 'vault' order by b`)).map((r) => Number(r.b));

{
  await reset();
  process.env[BF_ENV] = "600000";
  chain.logs = [599_000, 600_000, 700_000, 899_969, 899_970, 950_000].map((b) => log(b, "dep", ADDR(1), BigInt(b)));
  const r = await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: fills history from the start block up to where the forward scan began", r?.backfill?.done === true && r.backfill.end === 899_970, r?.backfill);
  check("backfill: every log in range is captured once (boundary block not doubled; log before the start not read)", JSON.stringify(await blocksOf()) === JSON.stringify([600_000, 700_000, 899_969, 899_970, 950_000]), await blocksOf());
  check("backfill: never reads before the configured start block", Math.min(...chain.calls.map((c) => c.from)) === 600_000, chain.calls[0]);
  const st = await bfState();
  check("backfill: finished state is recorded", st?.done === true && st.from === 600_000 && st.end === 899_970 && st.next === 899_971, st);
  chain.calls = [];
  const again = await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: once done, later runs do no historical scanning at all", again?.backfill?.done === true && again.backfill.events === 0 && chain.calls.length === 0, { again: again?.backfill, calls: chain.calls.length });
}

{
  await reset();
  chain.logs = [320_000, 420_000, 520_000, 620_000, 720_000, 820_000].map((b) => log(b, "dep", ADDR(2), BigInt(b)));
  await syncVault(HADRIAN, { deadline: FAR() }); // forward only: establishes the origin
  process.env[BF_ENV] = "300000";
  chain.latencyMs = 30;
  const partial = await syncVault(HADRIAN, { deadline: Date.now() + 25 });
  const st = await bfState();
  check("backfill: a deadline stops after a whole batch and saves exactly that progress", partial?.backfill?.done === false && st?.next === 300_000 + 80_000 && JSON.stringify(await blocksOf()) === JSON.stringify([320_000]), { st, blocks: await blocksOf() });
  chain.latencyMs = 0;
  let rounds = 0;
  while (!(await bfState())?.done && rounds++ < 20) await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: resuming finishes the range: every log once, no gaps", JSON.stringify(await blocksOf()) === JSON.stringify([320_000, 420_000, 520_000, 620_000, 720_000, 820_000]), await blocksOf());
}

{
  await reset();
  await syncVault(HADRIAN, { deadline: FAR() });
  process.env[BF_ENV] = "300000";
  chain.logs = [320_000, 520_000, 820_000, 1_000_100].map((b) => log(b, "dep", ADDR(3), BigInt(b)));
  chain.head = 1_000_500; // the chain moved on: the forward scan has one genuinely new event to find
  chain.failFrom.add(300_000 + 80_000 + 20_000); // a page in the SECOND historical batch fails
  const r = await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: a failing historical page is reported but does not take the forward result down", r !== null && r.caughtUp === true && typeof r.backfill?.error === "string" && r.events === 1, r);
  const st = await bfState();
  check("backfill: its cursor stays at the last fully-successful batch", st?.next === 380_000 && !st.done, st);
  const summary = await runIndexer({ budgetMs: 30_000 });
  check("backfill: the run summary lists the failure among its errors", summary.errors.some((e) => e.includes("vault backfill")), summary.errors);
  chain.failFrom.clear();
  let rounds = 0;
  while (!(await bfState())?.done && rounds++ < 20) await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: after the failure clears, nothing was lost", JSON.stringify(await blocksOf()) === JSON.stringify([320_000, 520_000, 820_000, 1_000_100]), await blocksOf());
}

{
  await reset();
  await syncVault(HADRIAN, { deadline: FAR() });
  chain.logs = [710_000, 790_000, 810_000, 890_000].map((b) => log(b, "dep", ADDR(4), BigInt(b)));
  process.env[BF_ENV] = "800000";
  await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: first pass covers only from 800,000", JSON.stringify(await blocksOf()) === JSON.stringify([810_000, 890_000]), await blocksOf());
  chain.calls = [];
  process.env[BF_ENV] = "700000"; // a deeper start is configured later
  await syncVault(HADRIAN, { deadline: FAR() });
  const lo = chain.calls.length ? Math.min(...chain.calls.map((c) => c.from)) : -1;
  const hi = chain.calls.length ? Math.max(...chain.calls.map((c) => c.to)) : -1;
  check("backfill: lowering the start block scans ONLY the newly uncovered range", lo === 700_000 && hi <= 799_999, { lo, hi });
  check("backfill: ...and picks up the earlier logs", JSON.stringify(await blocksOf()) === JSON.stringify([710_000, 790_000, 810_000, 890_000]), await blocksOf());
  const st = await bfState();
  check("backfill: the extended state is recorded", st?.done === true && st.from === 700_000, st);
}

{
  await reset();
  process.env[BF_ENV] = "950000"; // newer than the forward origin: nothing to backfill
  const r = await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: a start block inside the forward range is a no-op (no state, no scanning)", r?.backfill === undefined && (await bfState()) === null);
  delete process.env[BF_ENV];
  const none = await syncVault(HADRIAN, { deadline: FAR() });
  check("backfill: with nothing configured the result has no backfill section", none?.backfill === undefined);
  process.env[BF_ENV] = "not-a-block";
  check("backfill: a malformed setting is ignored rather than breaking the scan", (await syncVault(HADRIAN, { deadline: FAR() }))?.backfill === undefined);
}

{
  await reset();
  // A deployment already running from before backfill existed: the forward cursor has no recorded origin.
  await query(`insert into indexer_state (key, value) values ($1, $2::jsonb)`, [`vault:${HADRIAN.chainId}`, JSON.stringify({ next: 899_970, page: 10_000 })]);
  chain.logs = [810_000, 899_900, 950_000].map((b) => log(b, "dep", ADDR(5), BigInt(b)));
  process.env[BF_ENV] = "800000";
  const r = await syncVault(HADRIAN, { deadline: FAR() });
  const st = await bfState();
  check("backfill: on an existing deployment (no origin saved) it ends where the forward cursor stood", r?.backfill?.done === true && st?.end === 899_970, st);
  check("backfill: ...and captures the history the forward scan had skipped", JSON.stringify(await blocksOf()) === JSON.stringify([810_000, 899_900, 950_000]), await blocksOf());
}

{
  await reset();
  await syncVault(HADRIAN, { deadline: FAR() });
  chain.logs = [650_000, 750_000, 850_000].map((b) => log(b, "dep", ADDR(6), BigInt(b)));
  process.env[BF_ENV] = "600000";
  await Promise.all([syncVault(HADRIAN, { deadline: FAR() }), syncVault(HADRIAN, { deadline: FAR() })]);
  const st = await bfState();
  check("backfill: two overlapping runs create one backfill and no duplicate events", st?.done === true && (await count("source = 'vault'")) === 3 && JSON.stringify(await blocksOf()) === JSON.stringify([650_000, 750_000, 850_000]), { st, blocks: await blocksOf() });
}

/* -------------------------------------------------------------- bridge */
{
  await reset();
  const A = "0x37ebCc82F552370aDBCA0C0E6a2c7dCd324F0CAb";
  const pending = { id: "txf_1", route: "usdc-cctp-to-rome", direction: "to-rome", amountIn: "2000000", outcome: "pending", sender: { ethereum: A }, steps: [{ chainId: "200010", rollupProgramId: "RPTW…" }], createdAt: "2026-10-01T10:00:00.000Z", completedAt: null };
  bridge.transfers.set(A.toLowerCase(), [pending]);
  const r1 = await syncBridgeForAddress(A.toLowerCase(), { force: true });
  const row = (await query(`select kind, address, amount, asset, status, chain_id, completed_at from chain_events where source = 'bridge'`))[0];
  check("bridge: a transfer is recorded with kind, normalized actor, amount, asset, status and Rome chain", r1.changed === 1 && row.kind === "bridge_in" && row.address === A.toLowerCase() && row.amount === "2000000" && row.asset === "usdc" && row.status === "pending" && Number(row.chain_id) === 200010, row);

  bridge.transfers.set(A.toLowerCase(), [{ ...pending, outcome: "complete", completedAt: "2026-10-01T10:19:00.000Z" }]);
  const r2 = await syncBridgeForAddress(A.toLowerCase(), { force: true });
  const after = await query(`select status, completed_at from chain_events where source = 'bridge'`);
  check("bridge: pending → complete updates the same row in place", r2.changed === 1 && after.length === 1 && after[0].status === "complete" && after[0].completed_at != null, after);

  const r3 = await syncBridgeForAddress(A.toLowerCase(), { force: true });
  check("bridge: re-syncing an unchanged transfer changes nothing", r3.changed === 0 && (await count("source = 'bridge'")) === 1, r3);

  bridge.calls = [];
  const throttled = await syncBridgeForAddress(A.toLowerCase());
  check("bridge: the per-wallet throttle skips the HTTP call", throttled.skipped === true && bridge.calls.length === 0, throttled);

  bridge.transfers.set(SOLANA, [
    { id: "txf_2", route: "usdc-cctp-from-rome", direction: "from-rome", amountIn: "1500000", outcome: "complete", sender: { solana: SOLANA }, createdAt: "2026-10-02T10:00:00.000Z" },
    { route: "no-id" }, // malformed: no id
    { id: "txf_3", direction: "to-rome", amountIn: "abc", outcome: "pending", sender: { ethereum: "not-an-address" }, createdAt: "garbage" },
  ]);
  const r4 = await syncBridgeForAddress(SOLANA, { force: true });
  const out = await query(`select kind, address, amount, occurred_at from chain_events where external_id in ('txf_2','txf_3') order by external_id`);
  check("bridge: from-rome transfers are bridge_out, attributed to the Solana sender", out[0].kind === "bridge_out" && out[0].address === SOLANA && out[0].amount === "1500000", out);
  check("bridge: malformed records never crash a sync (bad id skipped, bad amount/date stored as null)", r4.fetched === 3 && out.length === 2 && out[1].amount === null && out[1].occurred_at === null && out[1].address === SOLANA, { r4, out });

  bridge.fail = true;
  let threw = false;
  try { await syncBridgeForAddress("0x" + "ab".repeat(20), { force: true }); } catch { threw = true; }
  check("bridge: an API failure surfaces as an error (and is not recorded as a successful sync)", threw && (await getState(`bridge:0x${"ab".repeat(20)}`)) === null);
}

/* ----------------------------------------------------------- snapshots */
{
  await reset();
  const w = ADDR(0xabc);
  chain.nonces.set(`${new URL(HADRIAN.proxyUrl).host}:${w}`, 3);
  chain.balances.set(`${new URL(HADRIAN.proxyUrl).host}:${w}`, 5_000_000_000_000_000_000n);
  const a = await snapshotAddress(w, NETWORKS);
  const b = await snapshotAddress(w, NETWORKS);
  check("snapshots: first sight records every network; an unchanged wallet records nothing", a.inserted === NETWORKS.length && b.inserted === 0, { a, b });
  chain.nonces.set(`${new URL(HADRIAN.proxyUrl).host}:${w}`, 4);
  const c = await snapshotAddress(w, NETWORKS);
  const latest = (await query(`select nonce, gas_balance from wallet_snapshots where address = $1 and chain_id = $2 order by id desc limit 1`, [w, HADRIAN.chainId]))[0];
  check("snapshots: a new transaction (nonce change) records one new row, on that chain only", c.inserted === 1 && Number(latest.nonce) === 4 && String(latest.gas_balance).split(".")[0] === "5000000000000000000", { c, latest });
}

/* ------------------------------------------- attribution + endpoints */
async function account(wallets: { kind: "evm" | "solana"; address: string; synthetic?: string }[]) {
  const id = (await query(`insert into accounts default values returning id`))[0].id as string;
  for (const w of wallets) await query(`insert into wallets (account_id, kind, address, synthetic_address) values ($1, $2, $3, $4)`, [id, w.kind, w.address, w.synthetic ?? null]);
  const cookie = (await startSession(new Request("http://localhost:5188/"), id)).split(";")[0];
  return { id, cookie };
}
const call = (h: (r: Request) => Promise<Response>, path: string, method: "GET" | "POST", cookie?: string, headers: Record<string, string> = {}) =>
  h(new Request("http://localhost:5188" + path, { method, headers: { host: "localhost:5188", origin: "http://localhost:5188", ...(method === "POST" ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: method === "POST" ? "{}" : undefined }));

{
  await reset();
  const X = await account([{ kind: "evm", address: ADDR(0x11) }, { kind: "solana", address: SOLANA, synthetic: SYNTH }]);
  const Z = await account([{ kind: "evm", address: ADDR(0x22) }]);
  await query(`insert into chain_events (source, kind, chain_id, address, amount, external_id, occurred_at) values
    ('vault','vault_deposit',200010,$1,100,'a:1',now()),
    ('vault','vault_deposit',200010,$2,200,'b:1',now()),
    ('bridge','bridge_in',200010,$3,300,'txf_x',now()),
    ('vault','vault_withdraw',200010,$4,400,'c:1',now())`, [SYNTH, ADDR(0x22), ADDR(0x11), ADDR(0x99)]);

  const ax = await (await call(activity.GET, "/api/account/activity", "GET", X.cookie)).json();
  const az = await (await call(activity.GET, "/api/account/activity", "GET", Z.cookie)).json();
  const addrsX = ax.events.map((e: any) => e.address).sort();
  check("activity: an account sees events for its EVM address AND its Solana lane's synthetic address", addrsX.length === 2 && addrsX.includes(SYNTH) && addrsX.includes(ADDR(0x11)), addrsX);
  check("activity: an account never sees another account's events", az.events.length === 1 && az.events[0].address === ADDR(0x22) && !JSON.stringify(az).includes(ADDR(0x11)), az);
  check("activity: unauthenticated requests are refused", (await call(activity.GET, "/api/account/activity", "GET")).status === 401);
  check("activity: totals are aggregated per kind and status", ax.totals.some((t: any) => t.kind === "vault_deposit" && t.count === 1 && t.amount === "100"), ax.totals);

  await query(`insert into wallets (account_id, kind, address) values ($1, 'evm', $2)`, [Z.id, ADDR(0x99)]);
  const az2 = await (await call(activity.GET, "/api/account/activity", "GET", Z.cookie)).json();
  check("activity: linking a wallet later brings in its earlier history at once", az2.events.some((e: any) => e.address === ADDR(0x99) && e.kind === "vault_withdraw") && az2.events.length === 2, az2.events);

  // on-demand sync
  bridge.calls = [];
  check("sync: refused without a session", (await call(sync.POST, "/api/account/sync", "POST")).status === 401);
  const s1 = await (await call(sync.POST, "/api/account/sync", "POST", X.cookie)).json();
  check("sync: runs for the caller's wallets only", s1.skipped === false && s1.summary.wallets === 2 && bridge.calls.every((a) => [ADDR(0x11), SOLANA, SYNTH].includes(a)) && !bridge.calls.includes(ADDR(0x22)), { s1, calls: bridge.calls });
  const s2 = await (await call(sync.POST, "/api/account/sync", "POST", X.cookie)).json();
  check("sync: a second call within a minute is throttled", s2.skipped === true && s2.retryInSeconds > 0, s2);
  const sc = await call(sync.POST, "/api/account/sync", "POST", X.cookie, { origin: "https://evil.example" });
  check("sync: cross-site POST refused", sc.status === 403);
}

{
  await reset();
  await account([{ kind: "evm", address: ADDR(0x31) }]);
  await account([{ kind: "evm", address: ADDR(0x32) }]);
  const closed = await call(cron.GET, "/api/cron/index", "GET");
  check("cron: with no CRON_SECRET configured the endpoint is closed (503)", closed.status === 503);
  process.env.CRON_SECRET = "short";
  check("cron: a weak secret is treated as not configured", (await call(cron.GET, "/api/cron/index", "GET", undefined, { authorization: "Bearer short" })).status === 503);
  process.env.CRON_SECRET = "test-cron-secret-0123456789";
  check("cron: no token → 401", (await call(cron.GET, "/api/cron/index", "GET")).status === 401);
  check("cron: wrong token → 401", (await call(cron.GET, "/api/cron/index", "GET", undefined, { authorization: "Bearer test-cron-secret-0000000000" })).status === 401);
  check("cron: a longer or shorter token → 401", (await call(cron.GET, "/api/cron/index", "GET", undefined, { authorization: "Bearer test-cron-secret-0123456789x" })).status === 401);
  bridge.calls = [];
  chain.logs = [log(999_900, "dep", ADDR(0x31), 42n)];
  const ok = await call(cron.GET, "/api/cron/index", "GET", undefined, { authorization: "Bearer test-cron-secret-0123456789" });
  const body = await ok.json();
  check("cron: the right token runs a full pass over every wallet and the vault", ok.status === 200 && body.wallets === 2 && new Set(bridge.calls).size === 2 && body.vault.length === 1 && (await count("source = 'vault'")) === 1, body);
  const st = await (await call(cron.GET, "/api/cron/index?status=1", "GET", undefined, { authorization: "Bearer test-cron-secret-0123456789" })).json();
  check("cron: ?status=1 reports counts and cursors without doing work", st.wallets === 2 && st.events.some((e: any) => e.kind === "vault_deposit" && e.count === 1) && st.vaultCursors.length === 1, st);

  // a failing source must not stop the others
  await reset();
  await account([{ kind: "evm", address: ADDR(0x41) }]);
  bridge.fail = true;
  chain.logs = [log(999_900, "dep", ADDR(0x41), 1n)];
  const partial = await runIndexer({ budgetMs: 30_000, force: true });
  check("run: a failing bridge API is reported but snapshots and the vault scan still complete", partial.errors.some((e) => e.startsWith("bridge")) && partial.vault.length === 1 && (await count("source = 'vault'")) === 1, partial);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
