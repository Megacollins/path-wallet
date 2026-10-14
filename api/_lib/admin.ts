// The owner's view of Path: who is using it, what they've earned, and whether the indexer is healthy.
//
// Who is an admin: a signed-in account that has a wallet from the ADMIN_WALLETS list linked to it. Linking a wallet
// takes a signature from that wallet, so being on the list means controlling the wallet; nothing is typed in or
// pasted. With ADMIN_WALLETS unset nobody is an admin: closed by default, never open.
import { fail, normalizeAddress, sessionInfo, type Kind } from "./auth.js";
import { query } from "./db.js";
import { getState } from "./indexer/state.js";
import { RULES_VERSION, currentSeason } from "./points/rules.js";

/** ADMIN_WALLETS: addresses separated by commas or spaces. EVM (0x…) and Solana (base58) can be mixed. */
export function adminWallets(raw = process.env.ADMIN_WALLETS): { evm: string[]; solana: string[] } {
  const out = { evm: [] as string[], solana: [] as string[] };
  for (const part of String(raw ?? "").split(/[\s,]+/).filter(Boolean)) {
    const kind: Kind = part.startsWith("0x") ? "evm" : "solana";
    const a = normalizeAddress(kind, part);
    if (a && !out[kind].includes(a)) out[kind].push(a);
  }
  return out;
}

export async function isAdmin(accountId: string): Promise<boolean> {
  const list = adminWallets();
  if (!list.evm.length && !list.solana.length) return false;
  const rows = await query(
    `select 1 from wallets where account_id = $1 and ((kind = 'evm' and address = any($2::text[])) or (kind = 'solana' and address = any($3::text[]))) limit 1`,
    [accountId, list.evm, list.solana],
  );
  return rows.length > 0;
}

/** Admin power lasts only as long as a FRESH sign-in: the session must have been started within this many hours. */
export const adminSessionHours = (raw = process.env.ADMIN_SESSION_HOURS) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 12;
};

export type AdminCheck = { ok: true; accountId: string } | { ok: false; status: number; error: string; message: string };

/** Is this request from an admin with a fresh sign-in? (A long-lived cookie alone is not enough for admin.) */
export async function adminCheck(req: Request): Promise<AdminCheck> {
  const s = await sessionInfo(req);
  if (!s) return { ok: false, status: 401, error: "not_signed_in", message: "Sign in first." };
  if (!(await isAdmin(s.accountId))) return { ok: false, status: 403, error: "forbidden", message: "This account isn't an admin." };
  if (Date.now() - s.createdAt.getTime() > adminSessionHours() * 3600_000) return { ok: false, status: 401, error: "reauth", message: `Admin sessions last ${adminSessionHours()} hours. Sign in again.` };
  return { ok: true, accountId: s.accountId };
}

/** The admin's account id, or the response to send instead (401 not signed in or stale, 403 not an admin). */
export async function requireAdmin(req: Request): Promise<{ accountId: string } | Response> {
  const c = await adminCheck(req);
  return c.ok ? { accountId: c.accountId } : fail(c.status, c.error, c.message);
}

/** A whole number from user input, clamped; junk (NaN, "abc", Infinity) falls back to the default instead of reaching SQL. */
const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Counts, cursors and freshness of everything the indexer has recorded. */
export async function indexerStatus() {
  const [byKind, wallets, cursors, snaps, newest, lastAll, lastAccount] = await Promise.all([
    query(`select source, kind, chain_id, status, count(*)::int as n from chain_events group by source, kind, chain_id, status order by source, kind, chain_id, status`),
    query(`select count(*)::int as n from wallets`),
    query(`select key, value, updated_at from indexer_state where key like 'vault%' order by key`),
    query(`select count(*)::int as n from wallet_snapshots`),
    query(`select max(first_seen_at) as at from chain_events`),
    getState("indexer:last:all"),
    getState("indexer:last:account"),
  ]);
  return {
    wallets: wallets[0]?.n ?? 0,
    snapshots: snaps[0]?.n ?? 0,
    newestEventSeenAt: iso(newest[0]?.at),
    events: byKind.map((r) => ({ source: r.source, kind: r.kind, chainId: Number(r.chain_id), status: r.status, count: Number(r.n) })),
    vaultCursors: cursors.map((c) => ({ key: c.key, ...c.value, updatedAt: iso(c.updated_at) })),
    lastFullRun: lastAll,
    lastAccountSync: lastAccount,
  };
}

/** Points totals and the top accounts. */
export async function leaderboard(limit = 25) {
  const season = currentSeason();
  const [top, totals] = await Promise.all([
    query(
      `select l.account_id, sum(l.points)::int as points, count(*)::int as entries, (select count(*)::int from wallets w where w.account_id = l.account_id) as wallets
         from points_ledger l where l.season = $1 group by l.account_id order by points desc, l.account_id limit $2`,
      [season, limit],
    ),
    query(`select rule, sum(points)::int as points, count(*)::int as entries from points_ledger where season = $1 group by rule order by points desc`, [season]),
  ]);
  return {
    season,
    rulesVersion: RULES_VERSION,
    totalPoints: totals.reduce((s, r) => s + Number(r.points), 0),
    byRule: totals.map((r) => ({ rule: r.rule, points: Number(r.points), entries: Number(r.entries) })),
    top: top.map((r, i) => ({ rank: i + 1, accountId: String(r.account_id), account: String(r.account_id).slice(0, 8), points: Number(r.points), entries: Number(r.entries), wallets: Number(r.wallets) })),
  };
}

/** Everything on one screen: users, activity, XP, the Vault, and the indexer. */
export async function overview() {
  const season = currentSeason();
  const [counts, kinds, dual, active, vault] = await Promise.all([
    query(`select count(*)::int as total, count(*) filter (where created_at > now() - interval '7 days')::int as new7, count(*) filter (where created_at > now() - interval '1 day')::int as new1 from accounts`),
    query(`select kind, count(*)::int as n from wallets group by kind`),
    query(`select count(*)::int as n from (select account_id from wallets group by account_id having count(distinct kind) = 2) d`),
    query(
      `select count(distinct account_id) filter (where day >= (now() at time zone 'utc')::date)::int as today,
              count(distinct account_id) filter (where day >= (now() at time zone 'utc')::date - 6)::int as week
         from points_ledger where season = $1 and rule in ('tx_activity', 'active_day')`,
      [season],
    ),
    query(
      `select kind, chain_id, count(*)::int as n, coalesce(sum(amount), 0)::text as amount from chain_events where source = 'vault' group by kind, chain_id order by chain_id, kind`,
    ),
  ]);
  const wallet = (k: string) => Number(kinds.find((r) => r.kind === k)?.n ?? 0);
  return {
    accounts: { total: Number(counts[0].total), new24h: Number(counts[0].new1), new7d: Number(counts[0].new7), bothLanes: Number(dual[0].n) },
    wallets: { evm: wallet("evm"), solana: wallet("solana") },
    active: { today: Number(active[0].today), week: Number(active[0].week) },
    points: await leaderboard(10),
    vault: vault.map((r) => ({ kind: r.kind, chainId: Number(r.chain_id), events: Number(r.n), amount: r.amount })),
    indexer: await indexerStatus(),
  };
}

export interface AccountRow {
  id: string;
  createdAt: string;
  points: number;
  lastEarnedAt: string | null;
  wallets: { kind: Kind; address: string; syntheticAddress: string | null }[];
}

/** One page of accounts. `q` matches an id prefix or part of any linked address. */
export async function listAccounts(opts: { q?: string; sort?: "new" | "points"; limit?: number; offset?: number } = {}): Promise<{ total: number; rows: AccountRow[] }> {
  const season = currentSeason();
  const limit = clampInt(opts.limit, 25, 1, 100);
  const offset = clampInt(opts.offset, 0, 0, 1_000_000_000);
  const q = String(opts.q ?? "").replace(/[^0-9A-Za-z]/g, "").slice(0, 64); // letters and digits only: also keeps % and _ out of the LIKE
  // The filter text sits at parameter number `p`, so the same clause serves the page query and the count query.
  const whereAt = (p: number) =>
    q
      ? `where a.id::text like $${p} || '%' or exists (select 1 from wallets w where w.account_id = a.id and (lower(w.address) like '%' || lower($${p}) || '%' or lower(coalesce(w.synthetic_address, '')) like '%' || lower($${p}) || '%'))`
      : `where $${p}::text = ''`;
  const order = opts.sort === "points" ? "points desc, a.created_at desc" : "a.created_at desc";
  const rows = await query(
    `select a.id, a.created_at, coalesce(sum(l.points), 0)::int as points, max(l.created_at) as last_at
       from accounts a left join points_ledger l on l.account_id = a.id and l.season = $1
       ${whereAt(2)} group by a.id order by ${order} limit ${limit} offset ${offset}`,
    [season, q],
  );
  const total = await query(`select count(*)::int as n from accounts a ${whereAt(1)}`, [q]);
  const ids = rows.map((r) => r.id as string);
  const wallets = ids.length ? await query(`select account_id, kind, address, synthetic_address from wallets where account_id = any($1::uuid[]) order by linked_at, kind`, [ids]) : [];
  return {
    total: Number(total[0]?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: iso(r.created_at)!,
      points: Number(r.points),
      lastEarnedAt: iso(r.last_at),
      wallets: wallets.filter((w) => w.account_id === r.id).map((w) => ({ kind: w.kind, address: w.address, syntheticAddress: w.synthetic_address ?? null })),
    })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One account in full: wallets, points by rule, the latest ledger rows, Rome transaction counts and recent events. */
export async function accountDetail(id: string) {
  if (!UUID.test(id)) return null;
  const season = currentSeason();
  const acc = await query(`select id, created_at from accounts where id = $1`, [id]);
  if (!acc[0]) return null;
  const wallets = await query(`select kind, address, synthetic_address, linked_at from wallets where account_id = $1 order by linked_at, kind`, [id]);
  const romeAddrs = wallets.flatMap((w) => (w.kind === "evm" ? [w.address] : w.synthetic_address ? [w.synthetic_address] : []));
  const allAddrs = [...wallets.map((w) => w.address), ...wallets.flatMap((w) => (w.synthetic_address ? [w.synthetic_address] : []))];
  const [byRule, recent, nonces, events] = await Promise.all([
    query(`select rule, sum(points)::int as points, count(*)::int as entries from points_ledger where account_id = $1 and season = $2 group by rule order by points desc`, [id, season]),
    query(`select rule, points, day::text as day, address, created_at from points_ledger where account_id = $1 and season = $2 order by id desc limit 50`, [id, season]),
    query(
      `select distinct on (address, chain_id) address, chain_id, nonce, taken_at from wallet_snapshots where address = any($1::text[]) order by address, chain_id, taken_at desc, id desc`,
      [romeAddrs],
    ),
    query(
      `select source, kind, chain_id, address, amount::text as amount, status, occurred_at, external_id from chain_events where address = any($1::text[]) order by coalesce(occurred_at, first_seen_at) desc limit 50`,
      [allAddrs],
    ),
  ]);
  return {
    id: acc[0].id as string,
    createdAt: iso(acc[0].created_at),
    season,
    total: byRule.reduce((s, r) => s + Number(r.points), 0),
    wallets: wallets.map((w) => ({ kind: w.kind, address: w.address, syntheticAddress: w.synthetic_address ?? null, linkedAt: iso(w.linked_at) })),
    byRule: byRule.map((r) => ({ rule: r.rule, points: Number(r.points), entries: Number(r.entries) })),
    recent: recent.map((r) => ({ rule: r.rule, points: Number(r.points), day: r.day, address: r.address, at: iso(r.created_at) })),
    romeTransactions: nonces.map((n) => ({ address: n.address, chainId: Number(n.chain_id), count: Number(n.nonce), asOf: iso(n.taken_at) })),
    events: events.map((e) => ({ source: e.source, kind: e.kind, chainId: Number(e.chain_id), address: e.address, amount: e.amount, status: e.status, at: iso(e.occurred_at), id: e.external_id })),
  };
}
