// Regression tests for the findings of the 2026-10-14 audit. Each block names the finding it guards.
//   npm run test:security
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;
delete process.env.CRON_SECRET;
delete process.env.ADMIN_WALLETS;
delete process.env.VERCEL;
delete process.env.AUTH_HOSTS;

import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { databaseUrl, query } from "../api/_lib/db.js";
import { MAX_WALLETS_PER_KIND, hostAllowed, startSession } from "../api/_lib/auth.js";
import * as challenge from "../api/auth/challenge.js";
import * as verify from "../api/auth/verify.js";
import * as logout from "../api/auth/logout.js";
import * as meApi from "../api/me.js";
import * as adminApi from "../api/admin/index.js";
import * as syncApi from "../api/account/sync.js";
import { claimSlot } from "../api/_lib/indexer/state.js";
import { scorePoints } from "../api/_lib/points/score.js";
import { amountString, baseUnitsOf, parseAmountSafe } from "../lib/format.js";
import { RULES } from "../api/_lib/points/rules.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const HOST = "localhost:5188";
const post = (h: (r: Request) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  h(new Request(`http://${HOST}${path}`, { method: "POST", headers: { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, ...headers }, body: JSON.stringify(body) }));
const get = (h: (r: Request) => Promise<Response>, path: string, headers: Record<string, string> = {}) => h(new Request(`http://${HOST}${path}`, { headers: { host: HOST, ...headers } }));
const signIn = async (acct = privateKeyToAccount(generatePrivateKey())) => {
  const c = await (await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: acct.address, purpose: "signin", chainId: 200010 })).json();
  const v = await post(verify.POST, "/api/auth/verify", { nonce: c.nonce, signature: await acct.signMessage({ message: c.message }) });
  return { acct, c, v, cookie: v.headers.get("set-cookie")!.split(";")[0] };
};
const hex = (n: number) => "0x" + n.toString(16).padStart(40, "0");

/* ------------------------------------------------ H1: the EVM message is real EIP-4361 */
{
  const u = privateKeyToAccount(generatePrivateKey());
  const c = await (await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: u.address, purpose: "signin", chainId: 200010 })).json();
  const parsed = parseSiweMessage(c.message);
  check("the EVM sign-in message parses as EIP-4361 (so wallets can check its domain)", parsed.domain === HOST && parsed.address === u.address && parsed.nonce === c.nonce && parsed.version === "1", parsed);
  check("…and it passes the standard validation for this domain and address", validateSiweMessage({ message: parsed as any, domain: HOST, address: u.address }) === true);
  check("…and it is NOT valid for any other domain (what a wallet uses to flag a look-alike site)", validateSiweMessage({ message: parsed as any, domain: "evil.example", address: u.address }) === false);
  check("…it carries the wallet's chain id when the app reports it, and a default when not", parsed.chainId === 200010 && parseSiweMessage((await (await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: u.address, purpose: "signin", chainId: "junk" })).json()).message).chainId === 1);
  const link = await (await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: u.address, purpose: "link" }, { cookie: (await signIn()).cookie })).json();
  check("a link message is valid EIP-4361 too", parseSiweMessage(link.message).domain === HOST && /Link this wallet/.test(link.message));
}

/* ------------------------------------------------ M4: only our own host may appear in a message */
{
  const u = privateKeyToAccount(generatePrivateKey());
  const evil = await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: u.address, purpose: "signin" }, { host: "evil.example", "x-forwarded-host": "evil.example", origin: "http://evil.example" });
  check("a challenge requested under another Host is refused (no message naming evil.example is ever issued)", evil.status === 400 && (await evil.json()).error === "bad_host");
  check("hostAllowed: localhost off Vercel; the production host only when configured; nothing else",
    hostAllowed("localhost:5188", {}) && hostAllowed("path-wallet.vercel.app", { VERCEL_PROJECT_PRODUCTION_URL: "path-wallet.vercel.app" }) && hostAllowed("app.example.com", { AUTH_HOSTS: "app.example.com, other.example.com" }) &&
      !hostAllowed("evil.example", { VERCEL_PROJECT_PRODUCTION_URL: "path-wallet.vercel.app" }) && !hostAllowed("localhost:5188", { VERCEL: "1" }) && !hostAllowed("", {}) && !hostAllowed("path-wallet.vercel.app.evil.example", { AUTH_HOSTS: "path-wallet.vercel.app" }));
}

/* ------------------------------------------------ L9: a cookie without an Origin isn't a browser on our page */
{
  const s = await signIn();
  const noOrigin = await logout.POST(new Request(`http://${HOST}/api/auth/logout`, { method: "POST", headers: { host: HOST, "content-type": "application/json", cookie: s.cookie }, body: "{}" }));
  check("a POST that carries the session cookie but no Origin is refused", noOrigin.status === 403, noOrigin.status);
  check("…and the session survived that refused request", (await (await get(meApi.GET, "/api/me", { cookie: s.cookie })).json()).account !== null);
  const bare = await post(logout.POST, "/api/auth/logout", {}, { origin: "" });
  check("a cookie-less POST without Origin still works (non-browser clients, health checks)", (await logout.POST(new Request(`http://${HOST}/api/auth/logout`, { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: "{}" }))).status === 200 && bare.status !== 500);
}

/* ------------------------------------------------ M3: per-caller limits on the challenge endpoint */
{
  const ip = { "x-vercel-forwarded-for": "203.0.113.7" };
  let ok = 0, limited = 0;
  for (let i = 0; i < 40; i++) {
    const r = await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: hex(0x5000 + i), purpose: "signin" }, ip);
    r.status === 200 ? ok++ : r.status === 429 && limited++;
  }
  check("one caller flooding the endpoint with fresh addresses is cut off after 30 a minute", ok === 30 && limited === 10, { ok, limited });
  const other = await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: hex(0x6001), purpose: "signin" }, { "x-vercel-forwarded-for": "198.51.100.9" });
  check("…without affecting anyone else", other.status === 200);
  const spoof = await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: hex(0x6002), purpose: "signin" }, { ...ip, "x-forwarded-for": "10.9.9.9" });
  check("…and a client-supplied X-Forwarded-For does not change who it is", spoof.status === 429);
  const rows = (await query(`select count(*)::int as n from rate_limits`))[0].n;
  check("limits are stored compactly (a row per caller per window, expiring)", rows >= 2 && rows < 10, rows);
}

/* ------------------------------------------------ M2: the wallet cap holds under simultaneous requests */
{
  const owner = await signIn();
  const kids = Array.from({ length: 12 }, () => privateKeyToAccount(generatePrivateKey()));
  const chs = await Promise.all(kids.map(async (w) => ({ w, ch: await (await post(challenge.POST, "/api/auth/challenge", { kind: "evm", address: w.address, purpose: "link" }, { cookie: owner.cookie })).json() })));
  const sigs = await Promise.all(chs.map(async ({ w, ch }) => ({ nonce: ch.nonce, signature: await w.signMessage({ message: ch.message }) })));
  const res = await Promise.all(sigs.map((s) => post(verify.POST, "/api/auth/verify", s, { cookie: owner.cookie })));
  const n = (await query(`select count(*)::int as n from wallets w join accounts a on a.id = w.account_id where w.kind = 'evm' and w.account_id = (select account_id from wallets where address = $1)`, [owner.acct.address.toLowerCase()]))[0].n;
  check(`12 simultaneous link requests end with exactly ${MAX_WALLETS_PER_KIND} EVM wallets on the account`, n === MAX_WALLETS_PER_KIND, { n, statuses: res.map((r) => r.status).join(",") });
  check("…the rest were told why (400), not given a server error", res.filter((r) => r.status === 200).length === MAX_WALLETS_PER_KIND - 1 && res.every((r) => r.status === 200 || r.status === 400), res.map((r) => r.status));
  check("the SQL cap equals MAX_WALLETS_PER_KIND (they must move together)", new RegExp(`n >= ${MAX_WALLETS_PER_KIND} then raise exception 'wallet_limit'`).test(readFileSync("api/_lib/migrations.ts", "utf8")));
}

/* ------------------------------------------------ H1 (admin): power needs a FRESH sign-in */
{
  const s = await signIn();
  process.env.ADMIN_WALLETS = s.acct.address;
  const ok = await get(adminApi.GET, "/api/admin/index?view=overview", { cookie: s.cookie });
  check("a fresh admin session works", ok.status === 200);
  await query(`update sessions set created_at = now() - interval '13 hours'`);
  const stale = await get(adminApi.GET, "/api/admin/index?view=overview", { cookie: s.cookie });
  check("the same session after 12 hours is refused with 'sign in again' (401, reauth)", stale.status === 401 && (await stale.json()).error === "reauth");
  check("…and /api/me stops advertising admin for it, while the normal session still works", (await (await get(meApi.GET, "/api/me", { cookie: s.cookie })).json()).admin === false && (await (await get(meApi.GET, "/api/me", { cookie: s.cookie })).json()).account !== null);
  delete process.env.ADMIN_WALLETS;
}

/* ------------------------------------------------ M1: the sync throttle is atomic, and there is a shared budget */
{
  globalThis.fetch = (async () => { throw new Error("offline in tests"); }) as typeof fetch; // the indexer's own calls never leave the test
  // The shared budget is a fixed one-minute window: start at the beginning of one so the test can't straddle two.
  const toNext = 60_000 - (Date.now() % 60_000);
  if (toNext < 5_000) await new Promise((r) => setTimeout(r, toNext + 200));
  const s = await signIn();
  let ran = 0;
  const rs = await Promise.all(Array.from({ length: 10 }, () => post(syncApi.POST, "/api/account/sync", {}, { cookie: s.cookie }).then((r) => r.json())));
  ran = rs.filter((r: any) => r.skipped === false).length;
  check("10 simultaneous syncs for one account: exactly one runs the indexer, the rest are told when to retry", ran === 1 && rs.filter((r: any) => r.skipped && r.retryInSeconds > 0).length === 9, { ran, rs: rs.map((r: any) => r.skipped) });

  const [a, b] = await Promise.all([claimSlot("t:x", 60_000), claimSlot("t:x", 60_000)]);
  check("claimSlot gives a slot to exactly one of two simultaneous callers", [a, b].filter((r) => r.ok).length === 1);
  await query(`update indexer_state set value = '{"at": 1}'::jsonb where key = 't:x'`);
  check("…and frees it again once the interval has passed", (await claimSlot("t:x", 60_000)).ok === true);

  // Many different accounts together: the shared per-minute budget caps full passes. Use up most of the budget first
  // (19 of 20), so the test is three quick syncs and can't be thrown off by how long a slow machine takes.
  await query(`delete from indexer_state where key like 'sync:%'`);
  const { hit } = await import("../api/_lib/limits.js");
  await query(`delete from rate_limits where key like 'sync-global:%'`); // start from an empty shared budget
  for (let i = 0; i < 19; i++) await hit("sync-global", 60_000);
  let full = 0, shared = 0;
  for (let i = 0; i < 3; i++) {
    const u = await signIn();
    const r = await (await post(syncApi.POST, "/api/account/sync", {}, { cookie: u.cookie })).json();
    if (r.skipped === false) full++; else if (r.skipped) shared++;
  }
  check("with 19 of the 20 shared passes already used this minute, three different accounts get exactly one full pass between them", full === 1 && shared === 2, { full, shared });
  const vaultSlots = await query(`select count(*)::int as n from indexer_state where key = 'sync:vault'`);
  check("the chain-wide Vault scan is claimed once for all of them, not per account", vaultSlots[0].n === 1);
}

/* ------------------------------------------------ H4: ledger size and scoring cost don't grow with transactions */
{
  await query(`truncate accounts, wallet_snapshots, points_ledger, chain_events cascade`);
  const id = (await query(`insert into accounts default values returning id`))[0].id;
  const e = hex(0xabc);
  await query(`insert into wallets (account_id, kind, address) values ($1,'evm',$2)`, [id, e]);
  await query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance, taken_at) values ($1,200010,0,0,'2026-10-14T01:00:00Z'), ($1,200010,20000,0,'2026-10-14T02:00:00Z')`, [e]);
  const noCap = { ...RULES, tx_activity: { ...RULES.tx_activity, dailyCapPerAccount: null } };
  const r1 = await scorePoints({ rules: noCap });
  const rowsAfter = (await query(`select count(*)::int as n from points_ledger where rule = 'tx_activity'`))[0].n;
  check("a wallet that sent 20,000 transactions in a day costs ONE ledger row (was 20,001)", rowsAfter === 1 && r1.byRule.tx_activity === 20000, { rowsAfter, r1 });
  const t = Date.now();
  const r2 = await scorePoints({ rules: noCap });
  const ms = Date.now() - t;
  check(`re-scoring with nothing new inserts nothing and is quick (${ms} ms; was ~800 ms and 20,001 insert attempts)`, r2.entries === 0 && ms < 400, { ms, r2 });
  await query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance, taken_at) values ($1,200010,20007,0,'2026-10-14T03:00:00Z')`, [e]);
  const r3 = await scorePoints({ rules: noCap });
  check("seven more transactions add exactly one more row worth 7", r3.awarded === 7 && r3.entries === 1 && (await query(`select count(*)::int as n from points_ledger where rule = 'tx_activity'`))[0].n === 2, r3);
  await query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance, taken_at) values ($1,200010,20010,0,'2026-10-14T04:00:00Z')`, [e]);
  await Promise.all([scorePoints({ rules: noCap }), scorePoints({ rules: noCap }), scorePoints({ rules: noCap })]);
  check("three scorers racing over the same new transactions pay them exactly once", (await query(`select coalesce(sum(points),0)::int as n from points_ledger where rule = 'tx_activity'`))[0].n === 20010);
}

/* ------------------------------------------------ H3: what a throwaway account can farm */
{
  await query(`truncate accounts, wallet_snapshots, points_ledger cascade`);
  const N = 100;
  for (let i = 0; i < N; i++) {
    const id = (await query(`insert into accounts default values returning id`))[0].id;
    const ev = hex(0x100000 + i), syn = hex(0x200000 + i);
    await query(`insert into wallets (account_id, kind, address) values ($1,'evm',$2)`, [id, ev]);
    await query(`insert into wallets (account_id, kind, address, synthetic_address) values ($1,'solana',$2,$3)`, [id, `Sol${i}`, syn]);
    for (const a of [ev, syn]) await query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance, taken_at) values ($1,200010,0,0,'2026-10-14T01:00:00Z'), ($1,200010,1,0,'2026-10-14T02:00:00Z')`, [a]);
  }
  const r = await scorePoints();
  check(`100 throwaway accounts doing one transaction per lane now earn ${r.awarded} XP in total (was 6,200): no dual-lane bonus, no active day`, r.awarded === 200 && !r.byRule.dual_lane && !r.byRule.active_day, r);

  // The same attacker doing the minimum that DOES qualify: bounded per account per day.
  await query(`truncate accounts, wallet_snapshots, points_ledger cascade`);
  const id = (await query(`insert into accounts default values returning id`))[0].id;
  const ws = [hex(0x300001), hex(0x300002), hex(0x300003)];
  for (const w of ws) {
    await query(`insert into wallets (account_id, kind, address) values ($1,'evm',$2)`, [id, w]);
    await query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance, taken_at) values ($1,200010,0,0,'2026-10-14T01:00:00Z'), ($1,200010,500,0,'2026-10-14T02:00:00Z')`, [w]);
  }
  await scorePoints();
  check("one account with three busy wallets can't earn more than the 100 a day cap from transactions", (await query(`select coalesce(sum(points),0)::int as n from points_ledger where rule = 'tx_activity'`))[0].n === 100);
  await Promise.all([scorePoints(), scorePoints()]);
  check("…even with scorers racing", (await query(`select coalesce(sum(points),0)::int as n from points_ledger where rule = 'tx_activity'`))[0].n === 100);
}

/* ------------------------------------------------ L3: a zero-value Vault call earns nothing */
{
  await query(`truncate accounts, chain_events, points_ledger cascade`);
  const id = (await query(`insert into accounts default values returning id`))[0].id;
  const e = hex(0xfeed);
  await query(`insert into wallets (account_id, kind, address) values ($1,'evm',$2)`, [id, e]);
  await query(`insert into chain_events (source, kind, chain_id, address, amount, external_id, occurred_at) values ('vault','vault_deposit',200010,$1,0,'0xaa:0',now()), ('vault','vault_withdraw',200010,$1,5000,'0xbb:0',now()), ('vault','vault_deposit',200010,$1,2000000,'0xcc:0',now())`, [e]);
  const r = await scorePoints({ rules: { ...RULES, vault: { ...RULES.vault, enabled: true } } });
  check("with the vault rule on, zero and dust amounts earn nothing; a real deposit earns", r.byRule.vault === 10, r);
}

/* ------------------------------------------------ L2/M6: what a Max button writes is always a valid amount that never exceeds the balance */
{
  check("2.15 - 0.3 (a float: 1.8499999999999999) is written as 1.85, not as 16 decimals", amountString(2.15 - 0.3, 6) === "1.85" && amountString(10.01 - 0.3, 6) === "9.71");
  check("it rounds DOWN, never up past what the wallet holds", amountString(1.2345678, 6) === "1.234567" && amountString(0.9999999, 6) === "0.999999");
  check("odd inputs are 0, not NaN or negative text", amountString(0, 6) === "0" && amountString(-5, 6) === "0" && amountString(NaN, 6) === "0" && amountString(Infinity, 6) === "0");
  check("18-decimal tokens are limited to 9 places (a number can't hold more) and still parse", amountString(0.3000000004, 18) === "0.3" && parseAmountSafe(amountString(1.123456789123, 18), 18) !== null);
  let bad = 0, over = 0;
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * 1000 - Math.random() * 0.3; // balance minus the gas reserve, as the Vault computes it
    if (x <= 0) continue;
    if (parseAmountSafe(amountString(x, 6), 6) === null) bad++;
    if (Number(baseUnitsOf(x, 6)) / 1e6 > x + 1e-9) over++;
  }
  check("for 3,000 random balances the Max amount always parses and never exceeds the balance", bad === 0 && over === 0, { bad, over });
}

/* ------------------------------------------------ M5: security headers are configured */
{
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
  const h = Object.fromEntries((cfg.headers?.find((x: any) => x.source === "/(.*)")?.headers ?? []).map((x: any) => [x.key.toLowerCase(), x.value]));
  check("every response asks browsers not to sniff types, not to be framed, and to send little referrer", h["x-content-type-options"] === "nosniff" && h["x-frame-options"] === "DENY" && /strict-origin/.test(h["referrer-policy"] ?? ""), h);
  check("the enforced CSP forbids framing, <base> tricks, plugins and foreign form posts", /frame-ancestors 'none'/.test(h["content-security-policy"] ?? "") && /object-src 'none'/.test(h["content-security-policy"] ?? "") && /base-uri 'self'/.test(h["content-security-policy"] ?? "") && /form-action 'self'/.test(h["content-security-policy"] ?? ""));
  check("a full script-restricting CSP runs in report-only mode first", /script-src 'self'/.test(h["content-security-policy-report-only"] ?? "") && !/unsafe-inline/.test((h["content-security-policy-report-only"] ?? "").match(/script-src[^;]*/)?.[0] ?? ""));
  check("camera, microphone and location are switched off", /camera=\(\)/.test(h["permissions-policy"] ?? "") && /microphone=\(\)/.test(h["permissions-policy"] ?? "") && /geolocation=\(\)/.test(h["permissions-policy"] ?? ""));
}

/* ------------------------------------------------ M8: a developer's machine never uses the production database by accident */
{
  const prod = "postgres://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db";
  check("on Vercel, DATABASE_URL is used", databaseUrl({ VERCEL: "1", DATABASE_URL: prod }) === prod);
  check("on a local machine, DATABASE_URL (production) is ignored by default", databaseUrl({ DATABASE_URL: prod }) === "");
  check("…a dev database of your own is used instead", databaseUrl({ DATABASE_URL: prod, DEV_DATABASE_URL: "postgres://dev" }) === "postgres://dev");
  check("…and production can still be chosen on purpose", databaseUrl({ DATABASE_URL: prod, ALLOW_LOCAL_PROD_DB: "1" }) === prod);
  check("with nothing set locally you get the throwaway in-process database", databaseUrl({}) === "");
}

/* ------------------------------------------------ L1: junk paging parameters on the admin API are harmless */
{
  const s = await signIn();
  process.env.ADMIN_WALLETS = s.acct.address;
  const statuses: Record<string, number> = {};
  for (const q of ["limit=abc", "offset=abc", "limit=-1", "limit=1e9", "offset=999999999999999999999", "limit=Infinity", "limit=&offset="]) {
    statuses[q] = (await get(adminApi.GET, `/api/admin/index?view=accounts&${q}`, { cookie: s.cookie })).status;
  }
  check("limit=abc, offset=abc, negative, huge, Infinity and empty values all answer 200 (clamped), never 500", Object.values(statuses).every((x) => x === 200), statuses);
  delete process.env.ADMIN_WALLETS;
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
