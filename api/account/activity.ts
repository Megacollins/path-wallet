// GET /api/account/activity → what the indexer has recorded for the signed-in account's wallets only.
// Events are attributed by joining on the account's wallet addresses at read time, so linking a wallet
// later immediately brings in its earlier history.
import { fail, json, sessionAccount } from "../_lib/auth.js";
import { query } from "../_lib/db.js";
import { addressesOf } from "../_lib/indexer/run.js";

export async function GET(req: Request): Promise<Response> {
  const accountId = await sessionAccount(req);
  if (!accountId) return fail(401, "not_signed_in", "Sign in first.");
  const { all } = await addressesOf(accountId);
  if (!all.length) return json({ events: [], snapshots: [], totals: {} });

  const events = await query(
    `select id, source, kind, chain_id, address, amount, asset, external_id, status, occurred_at, completed_at
       from chain_events where address = any($1::text[])
      order by occurred_at desc nulls last, id desc limit 200`,
    [all],
  );
  const snapshots = await query(
    `select distinct on (address, chain_id) address, chain_id, nonce, gas_balance, taken_at
       from wallet_snapshots where address = any($1::text[])
      order by address, chain_id, taken_at desc, id desc`,
    [all],
  );
  const totals = await query(
    `select kind, status, count(*)::int as n, coalesce(sum(amount), 0)::text as amount
       from chain_events where address = any($1::text[]) group by kind, status order by kind, status`,
    [all],
  );
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return json({
    events: events.map((e) => ({
      id: String(e.id),
      source: e.source,
      kind: e.kind,
      chainId: Number(e.chain_id),
      address: e.address,
      amount: e.amount == null ? null : String(e.amount).split(".")[0],
      asset: e.asset,
      status: e.status,
      occurredAt: iso(e.occurred_at),
      completedAt: iso(e.completed_at),
      externalId: e.external_id,
    })),
    snapshots: snapshots.map((s) => ({ address: s.address, chainId: Number(s.chain_id), transactions: Number(s.nonce), gasBalance: String(s.gas_balance).split(".")[0], at: iso(s.taken_at) })),
    totals: totals.map((t) => ({ kind: t.kind, status: t.status, count: Number(t.n), amount: String(t.amount).split(".")[0] })),
  });
}
