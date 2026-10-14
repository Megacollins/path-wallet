// Points scoring tests against an in-memory Postgres (PGlite). Facts (wallet snapshots, bridge/vault events)
// are inserted directly with chosen timestamps, then the real scorer runs. What matters most: nothing is ever
// paid twice (re-runs, overlapping runs, wallets moving between accounts), caps hold, and the ledger can't be edited.
//   npm run test:points
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;
delete process.env.CRON_SECRET;
delete process.env.POINTS_SEASON;

import { query } from "../api/_lib/db.js";
import { startSession } from "../api/_lib/auth.js";
import { RULES, RULES_VERSION, type Rules } from "../api/_lib/points/rules.js";
import { scorePoints } from "../api/_lib/points/score.js";
import * as pointsApi from "../api/account/points.js";
import * as cron from "../api/cron/index.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const HADRIAN = 200010;
const MARTIUS = 121214;
const hex = (n: number) => "0x" + n.toString(16).padStart(40, "0");
let seq = 0;

async function reset() {
  await query(`truncate accounts, chain_events, wallet_snapshots, indexer_state cascade`);
}
async function account(wallets: { kind: "evm" | "solana"; address: string; synthetic?: string }[]) {
  const id = (await query(`insert into accounts default values returning id`))[0].id as string;
  for (const w of wallets) await query(`insert into wallets (account_id, kind, address, synthetic_address) values ($1, $2, $3, $4)`, [id, w.kind, w.address, w.synthetic ?? null]);
  return id;
}
const snap = (address: string, chain: number, nonce: number, at: string) =>
  query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance, taken_at) values ($1, $2, $3, 0, $4)`, [address, chain, nonce, at]);
const bridge = (address: string, amountBase: number | null, status: string, completedAt: string | null) =>
  query(`insert into chain_events (source, kind, chain_id, address, amount, external_id, status, occurred_at, completed_at) values ('bridge', 'bridge_in', $1, $2, $3, $4, $5, $6, $7)`, [HADRIAN, address, amountBase, `txf_${++seq}`, status, completedAt ?? "2026-10-01T00:00:00Z", completedAt]);
const vault = (address: string, kind: "vault_deposit" | "vault_withdraw", at: string) =>
  query(`insert into chain_events (source, kind, chain_id, address, amount, external_id, occurred_at) values ('vault', $1, $2, $3, 1000000, $4, $5)`, [kind, HADRIAN, address, `0xv${++seq}:0`, at]);
const total = async (accountId: string, season = "devnet-1") => Number((await query(`select coalesce(sum(points), 0)::int as p from points_ledger where account_id = $1 and season = $2`, [accountId, season]))[0].p);
const rows = async (rule: string, accountId?: string) => Number((await query(`select count(*)::int as n from points_ledger where rule = $1 and ($2::uuid is null or account_id = $2::uuid)`, [rule, accountId ?? null]))[0].n);
const cookieFor = async (accountId: string) => (await startSession(new Request("http://localhost:5188/"), accountId)).split(";")[0];
const get = (h: (r: Request) => Promise<Response>, path: string, headers: Record<string, string> = {}) => h(new Request("http://localhost:5188" + path, { method: "GET", headers: { host: "localhost:5188", ...headers } }));

/* ---------------------------------------------------- transactions on Rome */
{
  await reset();
  const E = hex(0xa1);
  const A = await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 10, "2026-10-09T08:00:00Z");
  const first = await scorePoints();
  check("a wallet's first snapshot is only a baseline: its past earns nothing", first.awarded === 0 && first.entries === 0, first);

  await snap(E, HADRIAN, 13, "2026-10-09T12:00:00Z");
  const r1 = await scorePoints();
  check("3 new transactions = 3 tx points + 5 for the active day", r1.awarded === 8 && r1.byRule.tx_activity === 3 && r1.byRule.active_day === 5, r1);
  const refs = (await query(`select ref from points_ledger where rule = 'tx_activity' order by ref`)).map((r) => r.ref);
  check("each transaction slot is its own row with a deterministic ref", JSON.stringify(refs) === JSON.stringify([`${E}:2026-10-09:1`, `${E}:2026-10-09:2`, `${E}:2026-10-09:3`]), refs);
  check("scoring again changes nothing", (await scorePoints()).awarded === 0);

  await snap(E, HADRIAN, 16, "2026-10-09T18:00:00Z");
  const r2 = await scorePoints();
  check("later activity the same day adds only the new slots (no second active-day bonus)", r2.awarded === 3 && r2.byRule.active_day === undefined && (await rows("tx_activity")) === 6, r2);

  await snap(E, HADRIAN, 100, "2026-10-09T20:00:00Z"); // +84 more the same day
  const r3 = await scorePoints();
  check("a burst is paid in full: every one of the 90 transactions that day earns its point", (await rows("tx_activity")) === 90 && r3.awarded === 84, { rows: await rows("tx_activity"), r3 });
  check("…and a re-run is a no-op", (await scorePoints()).awarded === 0);

  await snap(E, HADRIAN, 101, "2026-10-10T01:00:00Z");
  const r4 = await scorePoints();
  check("the next UTC day starts fresh: 1 tx + a new active-day bonus", r4.awarded === 6 && (await rows("active_day")) === 2, r4);
  check("the account's balance is the sum of its ledger rows", (await total(A)) === 8 + 3 + 84 + 6, await total(A));
}

{
  await reset();
  const E = hex(0xa2);
  await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 0, "2026-10-09T23:00:00Z");
  await snap(E, HADRIAN, 1, "2026-10-09T23:59:59Z");
  await snap(E, HADRIAN, 2, "2026-10-10T00:00:01Z");
  await scorePoints();
  const days = (await query(`select day::text as d, count(*)::int as n from points_ledger where rule = 'tx_activity' group by day order by day`)).map((r) => `${r.d}:${r.n}`);
  check("activity is credited to the UTC day of the snapshot (23:59:59 vs 00:00:01)", JSON.stringify(days) === JSON.stringify(["2026-10-09:1", "2026-10-10:1"]), days);
}

{
  await reset();
  const E = hex(0xa3);
  await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(E, MARTIUS, 0, "2026-10-09T08:00:00Z");
  await snap(E, HADRIAN, 15, "2026-10-09T12:00:00Z");
  await snap(E, MARTIUS, 15, "2026-10-09T12:00:00Z");
  await scorePoints();
  check("transactions on every chain count (15 on each of two chains → 30 points, one active-day bonus)", (await rows("tx_activity")) === 30 && (await rows("active_day")) === 1);
}

{
  await reset();
  const E = hex(0xa4);
  await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(E, HADRIAN, 500, "2026-10-09T12:00:00Z");
  await scorePoints();
  check("a 500-transaction day is paid in full, with the default rules", (await rows("tx_activity")) === 500);
  await reset();
  await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(E, HADRIAN, 500, "2026-10-09T12:00:00Z");
  await scorePoints({ rules: { ...RULES, tx_activity: { enabled: true, perTx: 1, dailyCapPerWallet: 20 } } });
  check("a cap can still be switched on in the rules (kept as a knob, off by default)", (await rows("tx_activity")) === 20);
}

{
  await reset();
  const E = hex(0xa4);
  await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 50, "2026-10-09T08:00:00Z");
  await snap(E, HADRIAN, 20, "2026-10-09T09:00:00Z"); // chain reset / odd data: a decrease
  check("a transaction count that goes down earns nothing", (await scorePoints()).awarded === 0);
  await snap(E, HADRIAN, 22, "2026-10-09T10:00:00Z");
  check("…and counting resumes from the lower value", (await scorePoints()).byRule.tx_activity === 2);
}

/* --------------------------------------------------------------- bridge-ins */
{
  await reset();
  const E = hex(0xb1);
  const A = await account([{ kind: "evm", address: E }]);
  await bridge(E, 2_000_000, "complete", "2026-10-09T10:00:00Z");
  await bridge(E, 500_000, "complete", "2026-10-09T10:01:00Z"); // below the 1 USDC minimum
  await bridge(E, 5_000_000, "pending", null); // not settled yet
  await bridge(E, 3_000_000, "complete", "2026-10-09T10:05:00Z");
  await bridge(E, 1_000_000, "complete", "2026-10-09T10:10:00Z");
  await bridge(E, 1_000_000, "complete", "2026-10-09T10:15:00Z"); // 4th qualifying one that day
  await bridge(E, 2_000_000, "complete", "2026-10-10T09:00:00Z"); // next day
  await bridge(hex(0xdead), 9_000_000, "complete", "2026-10-09T10:00:00Z"); // nobody's wallet
  const r = await scorePoints();
  check("completed bridge-ins of 1+ USDC earn 25 each, max 3 a day per wallet (3 + 1 = 4 awards)", r.byRule.bridge_in === 100 && (await rows("bridge_in", A)) === 4, r);
  check("below-minimum, pending and unlinked-wallet transfers earn nothing", (await rows("bridge_in")) === 4);
  check("re-scoring a settled bridge-in does not pay again", (await scorePoints()).awarded === 0);
  await bridge(E, 2_000_000, "complete", "2026-10-09T10:30:00Z"); // a late-arriving 5th for day one
  check("a late-arriving transfer past the daily cap is not paid", (await scorePoints()).awarded === 0);
}

/* ---------------------------------------------------------------- dual lane */
{
  await reset();
  const E = hex(0xc1);
  const Y = hex(0xc2); // the Solana lane's synthetic Rome address
  const A = await account([{ kind: "evm", address: E }, { kind: "solana", address: "SoLaNaKeyForTestingOnly1111111111111111111111", synthetic: Y }]);
  await snap(E, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(E, HADRIAN, 1, "2026-10-09T09:00:00Z");
  const evmOnly = await scorePoints();
  check("an EVM transaction alone does not earn the dual-lane bonus", evmOnly.byRule.dual_lane === undefined && evmOnly.awarded === 6, evmOnly);
  await snap(Y, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(Y, HADRIAN, 2, "2026-10-09T09:30:00Z");
  const both = await scorePoints();
  check("once the Solana lane has transacted too, +50 once", both.byRule.dual_lane === 50 && (await rows("dual_lane", A)) === 1, both);
  const ref = (await query(`select ref from points_ledger where rule = 'dual_lane'`))[0].ref;
  check("the dual-lane award is keyed by account (one per account, ever)", ref === A, ref);
  check("…and never repeats", (await scorePoints()).byRule.dual_lane === undefined);
  check("the Solana lane's activity is credited to the account through its synthetic address", (await rows("tx_activity", A)) === 3);
}

/* ---------------------------------------- a wallet that moves between accounts */
{
  await reset();
  const W = hex(0xd1);
  const A = await account([{ kind: "evm", address: W }]);
  const B = await account([{ kind: "evm", address: hex(0xd2) }]);
  await snap(W, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(W, HADRIAN, 4, "2026-10-09T09:00:00Z");
  await bridge(W, 2_000_000, "complete", "2026-10-09T10:00:00Z");
  await scorePoints();
  const aBefore = await total(A);
  check("account A earned for the wallet's activity and bridge-in (4 + 5 + 25)", aBefore === 34, aBefore);

  await query(`delete from wallets where account_id = $1`, [A]);
  await query(`insert into wallets (account_id, kind, address) values ($1, 'evm', $2)`, [B, W]);
  const moved = await scorePoints();
  check("moving the wallet to another account does NOT re-pay what was already paid", moved.awarded === 0 && (await total(B)) === 0, moved);
  check("…and the first account keeps what it earned (the ledger is history)", (await total(A)) === aBefore);

  await snap(W, HADRIAN, 6, "2026-10-12T09:00:00Z");
  const fresh = await scorePoints();
  check("genuinely new activity now goes to the new owner", fresh.awarded === 7 && (await total(B)) === 7 && (await total(A)) === aBefore, { fresh, a: await total(A), b: await total(B) });
}

/* -------------------------------------------------------------------- vault */
{
  await reset();
  const W = hex(0xe1);
  const A = await account([{ kind: "evm", address: W }]);
  await vault(W, "vault_deposit", "2026-10-09T10:00:00Z");
  await vault(W, "vault_withdraw", "2026-10-09T10:05:00Z");
  await vault(W, "vault_deposit", "2026-10-09T10:10:00Z");
  check("Vault rule is off by default: nothing awarded", (await scorePoints()).awarded === 0);
  const on: Rules = { ...RULES, vault: { ...RULES.vault, enabled: true } };
  const r = await scorePoints({ rules: on });
  check("switched on: 10 per event, max 2 a day per wallet", r.byRule.vault === 20 && (await rows("vault", A)) === 2, r);
  check("…and idempotent", (await scorePoints({ rules: on })).awarded === 0);
}

/* ------------------------------------------------------------------ seasons */
{
  await reset();
  const E = hex(0xf1);
  const A = await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(E, HADRIAN, 5, "2026-10-09T09:00:00Z");
  await bridge(E, 2_000_000, "complete", "2026-10-09T10:00:00Z");
  await scorePoints();
  const s1 = await total(A, "devnet-1");
  const s2run = await scorePoints({ season: "devnet-2" });
  check("a new season replays the recorded history from scratch, independently", s2run.awarded === s1 && (await total(A, "devnet-2")) === s1 && (await total(A, "devnet-1")) === s1, { s1, s2run });
}

/* -------------------------------------------------- overlap + scoping + api */
{
  await reset();
  const E = hex(0x101);
  const A = await account([{ kind: "evm", address: E }]);
  await snap(E, HADRIAN, 0, "2026-10-09T08:00:00Z");
  await snap(E, HADRIAN, 60, "2026-10-09T09:00:00Z");
  for (let i = 0; i < 5; i++) await bridge(E, 1_500_000, "complete", `2026-10-09T10:0${i}:00Z`);
  await Promise.all([scorePoints(), scorePoints(), scorePoints()]);
  check("three scorers racing produce exactly one scorer's result: no duplicates, caps intact", (await total(A)) === 60 + 5 + 75 && (await query(`select count(*)::int as n from points_ledger`))[0].n === 64, { total: await total(A) });
}

{
  await reset();
  const EA = hex(0x201), EB = hex(0x202);
  const A = await account([{ kind: "evm", address: EA }]);
  const B = await account([{ kind: "evm", address: EB }]);
  for (const e of [EA, EB]) {
    await snap(e, HADRIAN, 0, "2026-10-09T08:00:00Z");
    await snap(e, HADRIAN, 2, "2026-10-09T09:00:00Z");
  }
  const onlyA = await scorePoints({ accountId: A });
  check("scoring one account touches only that account", (await total(B)) === 0 && (await total(A)) === 7 && onlyA.awarded === 7, onlyA);
  await scorePoints();
  check("a full pass then scores everyone", (await total(B)) === 7);

  const cookieA = await cookieFor(A);
  const mine = await (await get(pointsApi.GET, "/api/account/points", { cookie: cookieA })).json();
  check("the points endpoint shows the caller's total, per-rule breakdown, daily history and plain-English rules", mine.total === 7 && mine.byRule.some((r: any) => r.rule === "tx_activity" && r.points === 2) && mine.daily[0]?.day === "2026-10-09" && mine.rules.length === 5 && mine.rulesVersion === RULES_VERSION && mine.season === "devnet-1", mine);
  check("…and nothing of anyone else's (B's address never appears)", !JSON.stringify(mine).includes(EB));
  check("the points endpoint refuses callers who aren't signed in", (await get(pointsApi.GET, "/api/account/points")).status === 401);
}

/* --------------------------------------------------------- ledger integrity */
{
  let updErr = "", delErr = "";
  try { await query(`update points_ledger set points = 999999`); } catch (e: any) { updErr = String(e?.message ?? e); }
  try { await query(`delete from points_ledger`); } catch (e: any) { delErr = String(e?.message ?? e); }
  check("the database itself refuses to UPDATE the ledger", /append-only/.test(updErr), updErr.slice(0, 120));
  check("the database itself refuses to DELETE from the ledger", /append-only/.test(delErr), delErr.slice(0, 120));
  check("…so the rows are still all there", Number((await query(`select count(*)::int as n from points_ledger`))[0].n) > 0);
}

/* ---------------------------------------------------- owner-only leaderboard */
{
  const ask = (h: Record<string, string> = {}) => get(cron.GET, "/api/cron/index?points=1", h);
  check("leaderboard is closed with no CRON_SECRET (503)", (await ask()).status === 503);
  process.env.CRON_SECRET = "test-cron-secret-0123456789";
  check("leaderboard refuses a missing or wrong token (401)", (await ask()).status === 401 && (await ask({ authorization: "Bearer nope-nope-nope-nope-nope" })).status === 401);
  const res = await ask({ authorization: "Bearer test-cron-secret-0123456789" });
  const body = await res.json();
  check("the right token returns season totals and ranked accounts", res.status === 200 && body.top.length === 2 && body.top[0].points >= body.top[1].points && body.totalPoints === 14 && body.season === "devnet-1", body);
  check("the leaderboard exposes no wallet addresses", !JSON.stringify(body).match(/0x[0-9a-f]{40}/i), body);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
