// Admin API tests against an in-memory Postgres (PGlite). What matters most is who gets in: nobody when ADMIN_WALLETS
// is unset, only accounts that really have a listed wallet linked, never a stranger, a signed-out caller, or a
// non-admin; and that the one action (run the indexer) can't be forged cross-site or hammered.
//   npm run test:admin
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;
delete process.env.CRON_SECRET;
delete process.env.POINTS_SEASON;
delete process.env.ADMIN_WALLETS;

import { query } from "../api/_lib/db.js";
import { startSession } from "../api/_lib/auth.js";
import { accountDetail, adminWallets, isAdmin, listAccounts, overview } from "../api/_lib/admin.js";
import * as meApi from "../api/me.js";
import * as overviewApi from "../api/admin/overview.js";
import * as accountsApi from "../api/admin/accounts.js";
import * as accountApi from "../api/admin/account.js";
import * as runApi from "../api/admin/run.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

// The indexer's own network calls must never leave the test: every request fails fast and is recorded as an error.
globalThis.fetch = (async () => {
  throw new Error("offline in tests");
}) as typeof fetch;

const hex = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const SOL_ADMIN = "5sMAFYHCPnPdcZ1h6jUHwm3Zk3xuDbVYpRGTwJxcBo8d"; // shaped like a real base58 key; never signs anything here
const SOL_OTHER = "FJwwmwRVsBnXqMxUXq2J86Rkb9fyVrBBQsRhVcAGyU8Z";
const EVM_ADMIN = hex(0xad);
const EVM_OTHER = hex(0xb0);

async function account(wallets: { kind: "evm" | "solana"; address: string; synthetic?: string }[]) {
  const id = (await query(`insert into accounts default values returning id`))[0].id as string;
  for (const w of wallets) await query(`insert into wallets (account_id, kind, address, synthetic_address) values ($1, $2, $3, $4)`, [id, w.kind, w.address, w.synthetic ?? null]);
  return id;
}
const cookieFor = async (accountId: string) => (await startSession(new Request("http://localhost:5188/"), accountId)).split(";")[0];
const call = (h: (r: Request) => Promise<Response>, method: "GET" | "POST", path: string, headers: Record<string, string> = {}) =>
  h(new Request("http://localhost:5188" + path, { method, headers: { host: "localhost:5188", ...headers } }));
const ledger = (accountId: string, rule: string, ref: string, points: number, day = "2026-10-09") =>
  query(`insert into points_ledger (season, account_id, rule, ref, points, day, address, rules_version, detail) values ('devnet-1', $1, $2, $3, $4, $5, null, 1, '{}')`, [accountId, rule, ref, points, day]);

/* ------------------------------------------------------- the allowlist itself */
{
  const a = adminWallets(`${EVM_ADMIN.toUpperCase().replace("0X", "0x")}, ${SOL_ADMIN}  ${EVM_ADMIN} not-a-wallet,,0x123`);
  check("ADMIN_WALLETS accepts commas and spaces, mixes EVM and Solana, lowercases EVM, drops duplicates and junk", a.evm.length === 1 && a.evm[0] === EVM_ADMIN && a.solana.length === 1 && a.solana[0] === SOL_ADMIN, a);
  const empty = adminWallets("");
  check("an empty list means nobody", empty.evm.length === 0 && empty.solana.length === 0);
}

/* --------------------------------------------------------------- who gets in */
const admin = await account([{ kind: "evm", address: EVM_ADMIN }]);
const adminSol = await account([{ kind: "solana", address: SOL_ADMIN, synthetic: hex(0x5a) }]);
const user = await account([{ kind: "evm", address: EVM_OTHER }, { kind: "solana", address: SOL_OTHER, synthetic: hex(0x6b) }]);
const cAdmin = await cookieFor(admin);
const cAdminSol = await cookieFor(adminSol);
const cUser = await cookieFor(user);

{
  check("with ADMIN_WALLETS unset nobody is an admin, not even the account that would be", (await isAdmin(admin)) === false);
  check("…and the admin endpoints answer 403 to everyone", (await call(overviewApi.GET, "GET", "/api/admin/overview", { cookie: cAdmin })).status === 403);
}

process.env.ADMIN_WALLETS = `${EVM_ADMIN} ${SOL_ADMIN}`;
{
  check("an account with a listed EVM wallet is an admin", (await isAdmin(admin)) === true);
  check("an account with a listed Solana wallet is an admin", (await isAdmin(adminSol)) === true);
  check("an account without a listed wallet is not", (await isAdmin(user)) === false);

  const endpoints: [string, (r: Request) => Promise<Response>, string][] = [
    ["overview", overviewApi.GET, "/api/admin/overview"],
    ["accounts", accountsApi.GET, "/api/admin/accounts"],
    ["account", accountApi.GET, `/api/admin/account?id=${admin}`],
  ];
  for (const [name, h, path] of endpoints) {
    check(`${name}: signed out → 401`, (await call(h, "GET", path)).status === 401);
    check(`${name}: signed in but not an admin → 403`, (await call(h, "GET", path, { cookie: cUser })).status === 403);
    check(`${name}: an admin → 200`, (await call(h, "GET", path, { cookie: cAdmin })).status === 200);
  }
  check("a Solana-wallet admin gets in as well", (await call(overviewApi.GET, "GET", "/api/admin/overview", { cookie: cAdminSol })).status === 200);

  // Being on the list isn't enough on its own: the wallet has to be linked, and linking takes a signature.
  const stranger = await account([{ kind: "evm", address: hex(0xee) }]);
  check("an unlinked stranger is refused even though admins exist", (await isAdmin(stranger)) === false);

  const me = async (cookie?: string) => (await call(meApi.GET, "GET", "/api/me", cookie ? { cookie } : {})).json();
  check("/api/me tells the app who is an admin (so the link shows only for them)", (await me(cAdmin)).admin === true && (await me(cUser)).admin === false && (await me()).admin === false);
}

/* ------------------------------------------------------------------- the data */
{
  await ledger(admin, "tx_activity", "t1", 1);
  await ledger(user, "tx_activity", "t2", 1);
  await ledger(user, "bridge_in", "b1", 25);
  await ledger(user, "active_day", "d1", 5);
  await query(`insert into chain_events (source, kind, chain_id, address, amount, external_id, occurred_at) values ('vault', 'vault_deposit', 200010, $1, 2000000, '0xv1:0', now())`, [EVM_OTHER]);
  await query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance) values ($1, 200010, 7, 0)`, [EVM_OTHER]);

  const o = await overview();
  check("overview counts accounts, wallets by kind, and accounts using both lanes", o.accounts.total === 4 && o.wallets.evm === 3 && o.wallets.solana === 2 && o.accounts.bothLanes === 1, { a: o.accounts, w: o.wallets });
  check("overview totals the XP and splits it by rule", o.points.totalPoints === 32 && o.points.byRule.find((r) => r.rule === "bridge_in")?.points === 25, o.points);
  check("overview puts the top earner first", o.points.top[0].accountId === user && o.points.top[0].points === 31, o.points.top);
  check("overview summarises the Vault from the indexer's events", o.vault.length === 1 && o.vault[0].events === 1 && o.vault[0].amount.startsWith("2000000"), o.vault);

  const all = await listAccounts();
  check("the account list shows everyone with wallets and XP", all.total === 4 && all.rows.length === 4 && all.rows.find((r) => r.id === user)?.points === 31 && all.rows.find((r) => r.id === user)?.wallets.length === 2, all.rows.map((r) => r.points));
  check("sorted by XP, the top earner leads", (await listAccounts({ sort: "points" })).rows[0].id === user);
  check("search by an address fragment finds the account", (await listAccounts({ q: EVM_OTHER.slice(-8) })).rows.map((r) => r.id).join() === user);
  check("…by a Solana address, case-sensitively stored but matched either way", (await listAccounts({ q: SOL_ADMIN.slice(0, 8).toLowerCase() })).rows.map((r) => r.id).join() === adminSol);
  check("…by a Rome synthetic address", (await listAccounts({ q: hex(0x6b).slice(-8) })).rows.map((r) => r.id).join() === user);
  check("…by the start of an account id", (await listAccounts({ q: admin.slice(0, 8) })).rows.map((r) => r.id).join() === admin);
  const none = await listAccounts({ q: "zzzzzzzz" });
  check("a search with no match returns nothing, with a total of 0", none.rows.length === 0 && none.total === 0);
  check("wildcard characters in a search are inert (they're stripped, never matched)", (await listAccounts({ q: "%_%" })).total === 4 && (await listAccounts({ q: "'; drop table accounts;--" })).total === 0 && (await query(`select count(*)::int as n from accounts`))[0].n === 4);
  const page = await listAccounts({ limit: 2, offset: 0 });
  const page2 = await listAccounts({ limit: 2, offset: 2 });
  check("paging walks the whole list without repeats", page.rows.length === 2 && page2.rows.length === 2 && new Set([...page.rows, ...page2.rows].map((r) => r.id)).size === 4 && page.total === 4);
  check("an absurd limit is clamped", (await listAccounts({ limit: 100000 })).rows.length === 4 && (await listAccounts({ limit: -5 })).rows.length >= 1);

  const d = await accountDetail(user);
  check("account detail: wallets, XP total and per-rule split", d?.total === 31 && d.wallets.length === 2 && d.byRule.some((r) => r.rule === "bridge_in" && r.points === 25), d);
  check("…the latest ledger rows, the Rome transaction count and the account's Vault events", d?.recent.length === 3 && d.romeTransactions.some((n) => n.count === 7) && d.events.some((e) => e.kind === "vault_deposit"), d);
  check("…and never anyone else's data (the other accounts' wallets don't appear)", !JSON.stringify(d).includes(EVM_ADMIN) && !JSON.stringify(d).includes(SOL_ADMIN));
  check("a malformed or unknown id is just 'not found'", (await accountDetail("not-a-uuid")) === null && (await accountDetail("00000000-0000-4000-8000-000000000000")) === null && (await accountDetail("'; select 1;--")) === null);
  check("…over HTTP that is a 404", (await call(accountApi.GET, "GET", "/api/admin/account?id=nope", { cookie: cAdmin })).status === 404);
}

/* ----------------------------------------------------------- the one action */
{
  const post = (headers: Record<string, string>) => call(runApi.POST, "POST", "/api/admin/run", { "content-type": "application/json", origin: "http://localhost:5188", ...headers });
  check("run: signed out → 401, non-admin → 403", (await post({})).status === 401 && (await post({ cookie: cUser })).status === 403);
  check("run: a cross-site request is refused before anything else", (await post({ cookie: cAdmin, origin: "https://evil.example" })).status === 403 && (await query(`select count(*)::int as n from indexer_state where key = 'admin:run'`))[0].n === 0);
  check("run: a non-JSON post is refused (415)", (await call(runApi.POST, "POST", "/api/admin/run", { cookie: cAdmin, "content-type": "text/plain" })).status === 415);

  const r = await post({ cookie: cAdmin });
  const body = await r.json();
  check("run: an admin's run completes (with the chain unreachable it reports errors rather than crashing)", r.status === 200 && body.wallets === 5 && Array.isArray(body.errors), { status: r.status, wallets: body.wallets });
  const last = (await query(`select value from indexer_state where key = 'indexer:last:all'`))[0]?.value;
  check("…and the pass is remembered for the overview (when, how long, how many errors)", last && typeof last.at === "string" && last.wallets === 5 && typeof last.errors === "number", last);
  check("run: asking again straight away is turned away (429), so it can't be hammered", (await post({ cookie: cAdmin })).status === 429);
  check("the overview now reports that last run", (await overview()).indexer.lastFullRun?.wallets === 5);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
