// Turns recorded facts (wallet snapshots, bridge/vault events) into ledger rows, per the rules in rules.ts.
//
// Properties this is built around:
//  • Idempotent. Every award has a deterministic `ref` naming exactly what it's for; (season, rule, ref) is
//    unique, so running the scorer twice, or two runs at once, can never pay anything twice.
//  • Caps hold under concurrency. A cap isn't "sum then compare": it is the set of slots that may exist
//    (a wallet-day has transaction slots 1..cap), so two simultaneous runs cannot push past it.
//  • No double-pay across accounts. Refs are global (a wallet-day, a bridge transfer), not per account, so a
//    wallet moved from one account to another cannot be re-credited for what it was already paid for.
//  • Only the ledger is written. Nothing is ever updated or deleted (the database refuses it).
import { query } from "../db.js";
import { RULES, RULES_VERSION, currentSeason, type Rules } from "./rules.js";

export interface PointsSummary {
  season: string;
  /** Points added by this run. */
  awarded: number;
  /** Ledger rows added by this run. */
  entries: number;
  byRule: Record<string, number>;
}

interface Award {
  accountId: string;
  rule: string;
  ref: string;
  points: number;
  day: string | null;
  address: string | null;
  detail: Record<string, unknown>;
  /** For rules whose slots aren't numbered: refuse the insert once this many already exist for the wallet-day. */
  cap?: number;
}

/** One wallet-day's new transaction points: a single ledger row that tops the wallet-day up from `before` to `before + points`. */
interface TxDelta {
  accountId: string;
  address: string;
  day: string;
  before: number;
  points: number;
  txsThatDay: number;
  accountCap: number | null;
}

const utcDay = (v: unknown) => new Date(v as string).toISOString().slice(0, 10);

async function insertUnguarded(season: string, rows: Award[], out: PointsSummary) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const params: unknown[] = [];
    const tuples = chunk.map((a) => {
      const b = params.length;
      params.push(season, a.accountId, a.rule, a.ref, a.points, a.day, a.address, RULES_VERSION, JSON.stringify(a.detail));
      return `($${b + 1}::text, $${b + 2}::uuid, $${b + 3}::text, $${b + 4}::text, $${b + 5}::int, $${b + 6}::date, $${b + 7}::text, $${b + 8}::int, $${b + 9}::jsonb)`;
    });
    const res = await query(
      `insert into points_ledger (season, account_id, rule, ref, points, day, address, rules_version, detail)
       values ${tuples.join(", ")} on conflict (season, rule, ref) do nothing returning rule, points`,
      params,
    );
    for (const r of res) tally(out, r.rule, Number(r.points));
  }
}

async function insertGuarded(season: string, a: Award, out: PointsSummary) {
  const res = await query(
    `insert into points_ledger (season, account_id, rule, ref, points, day, address, rules_version, detail)
     select $1::text, $2::uuid, $3::text, $4::text, $5::int, $6::date, $7::text, $8::int, $9::jsonb
      where (select count(*) from points_ledger where season = $1::text and rule = $3::text and address = $7::text and day = $6::date) < $10::int
     on conflict (season, rule, ref) do nothing returning rule, points`,
    [season, a.accountId, a.rule, a.ref, a.points, a.day, a.address, RULES_VERSION, JSON.stringify(a.detail), a.cap],
  );
  for (const r of res) tally(out, r.rule, Number(r.points));
}

/**
 * Add one wallet-day's new transaction points as a single row. Written as a compare-and-set: it only inserts if the
 * wallet-day still holds exactly `before` (so two runs working from the same state can't both pay the same
 * transactions) and the account-day stays within its cap. A refused insert is picked up by the next run.
 */
async function insertTxDelta(season: string, d: TxDelta, out: PointsSummary) {
  const res = await query(
    `insert into points_ledger (season, account_id, rule, ref, points, day, address, rules_version, detail)
     select $1::text, $2::uuid, 'tx_activity', $3::text, $4::int, $5::date, $6::text, $7::int, $8::jsonb
      where (select coalesce(sum(points), 0) from points_ledger where season = $1::text and rule = 'tx_activity' and address = $6::text and day = $5::date) = $9::int
        and ($10::int is null or (select coalesce(sum(points), 0) from points_ledger where season = $1::text and rule = 'tx_activity' and account_id = $2::uuid and day = $5::date) + $4::int <= $10::int)
     on conflict (season, rule, ref) do nothing returning rule, points`,
    [season, d.accountId, `${d.address}:${d.day}:${d.before + d.points}`, d.points, d.day, d.address, RULES_VERSION, JSON.stringify({ txsThatDay: d.txsThatDay, from: d.before }), d.before, d.accountCap],
  );
  for (const r of res) tally(out, r.rule, Number(r.points));
}

function tally(out: PointsSummary, rule: string, points: number) {
  out.awarded += points;
  out.entries += 1;
  out.byRule[rule] = (out.byRule[rule] ?? 0) + points;
}

export async function scorePoints(opts: { accountId?: string; rules?: Rules; season?: string } = {}): Promise<PointsSummary> {
  const rules = opts.rules ?? RULES;
  const season = opts.season ?? currentSeason();
  const out: PointsSummary = { season, awarded: 0, entries: 0, byRule: {} };

  const wallets = opts.accountId
    ? await query(`select account_id, kind, address, synthetic_address from wallets where account_id = $1`, [opts.accountId])
    : await query(`select account_id, kind, address, synthetic_address from wallets`);
  if (!wallets.length) return out;

  // Every address an account is known by → who owns it and through which lane.
  const owner = new Map<string, { accountId: string; lane: "evm" | "solana" }>();
  const romeAddrs: string[] = []; // addresses that exist inside Rome's EVM, so they have a transaction count
  for (const w of wallets) {
    owner.set(w.address, { accountId: w.account_id, lane: w.kind });
    if (w.kind === "evm") romeAddrs.push(w.address);
    if (w.synthetic_address) {
      owner.set(w.synthetic_address, { accountId: w.account_id, lane: "solana" });
      romeAddrs.push(w.synthetic_address);
    }
  }

  const unguarded: Award[] = [];
  const guarded: Award[] = [];

  /* ---- transactions sent on Rome: tx_activity, active_day, dual_lane --------------------------------- */
  const txDeltas: TxDelta[] = [];
  if (romeAddrs.length && (rules.tx_activity.enabled || rules.active_day.enabled || rules.dual_lane.enabled)) {
    // The change in a wallet's transaction count between consecutive snapshots, credited to the UTC day of the
    // later snapshot. The first snapshot of a wallet is only a baseline: history before it earns nothing.
    const rows = await query(
      `with s as (
         select address, nonce, taken_at, lag(nonce) over (partition by address, chain_id order by taken_at, id) as prev
           from wallet_snapshots where address = any($1::text[])
       )
       select address, (taken_at at time zone 'utc')::date::text as day, sum(greatest(nonce - prev, 0))::int as txs
         from s where prev is not null
        group by address, day
       having sum(greatest(nonce - prev, 0)) > 0`,
      [romeAddrs],
    );
    const laneTxs = new Map<string, { evm: number; solana: number }>();
    const accountDays = new Map<string, { accountId: string; day: string; wallets: { address: string; txs: number }[] }>();
    for (const r of rows) {
      const o = owner.get(r.address);
      if (!o) continue;
      const txs = Number(r.txs);
      const l = laneTxs.get(o.accountId) ?? { evm: 0, solana: 0 };
      l[o.lane] += txs;
      laneTxs.set(o.accountId, l);
      const k = `${o.accountId}|${r.day}`;
      const ad: { accountId: string; day: string; wallets: { address: string; txs: number }[] } = accountDays.get(k) ?? { accountId: o.accountId, day: r.day, wallets: [] };
      ad.wallets.push({ address: r.address, txs });
      accountDays.set(k, ad);
      if (rules.active_day.enabled && txs >= rules.active_day.minTxs) {
        unguarded.push({ accountId: o.accountId, rule: "active_day", ref: `${r.address}:${r.day}`, points: rules.active_day.points, day: r.day, address: r.address, detail: { txsThatDay: txs } });
      }
    }
    if (rules.dual_lane.enabled) {
      for (const [accountId, l] of laneTxs) {
        if (l.evm >= rules.dual_lane.minTxsPerLane && l.solana >= rules.dual_lane.minTxsPerLane) unguarded.push({ accountId, rule: "dual_lane", ref: accountId, points: rules.dual_lane.points, day: null, address: null, detail: {} });
      }
    }

    if (rules.tx_activity.enabled && accountDays.size) {
      // What the ledger already holds for each wallet-day and each account-day. Points are never taken back, so the
      // work per run is the number of wallet-days with something NEW, not the number of transactions ever sent.
      const accountIds = [...new Set([...accountDays.values()].map((a) => a.accountId))];
      const haveWallet = new Map<string, number>();
      for (const r of await query(`select address, day::text as day, sum(points)::int as pts from points_ledger where season = $1 and rule = 'tx_activity' and address = any($2::text[]) group by address, day`, [season, romeAddrs])) haveWallet.set(`${r.address}|${r.day}`, Number(r.pts));
      const haveAccount = new Map<string, number>();
      for (const r of await query(`select account_id, day::text as day, sum(points)::int as pts from points_ledger where season = $1 and rule = 'tx_activity' and account_id = any($2::uuid[]) group by account_id, day`, [season, accountIds])) haveAccount.set(`${r.account_id}|${r.day}`, Number(r.pts));
      const perWalletCap = rules.tx_activity.dailyCapPerWallet;
      const perAccountCap = rules.tx_activity.dailyCapPerAccount;
      for (const ad of accountDays.values()) {
        let room = perAccountCap == null ? Infinity : Math.max(0, perAccountCap - (haveAccount.get(`${ad.accountId}|${ad.day}`) ?? 0));
        for (const w of [...ad.wallets].sort((a, b) => (a.address < b.address ? -1 : 1))) {
          const want = Math.min(w.txs, perWalletCap ?? Infinity) * rules.tx_activity.perTx;
          const got = haveWallet.get(`${w.address}|${ad.day}`) ?? 0;
          const delta = Math.min(want - got, room);
          if (delta <= 0) continue;
          room -= delta;
          txDeltas.push({ accountId: ad.accountId, address: w.address, day: ad.day, before: got, points: delta, txsThatDay: w.txs, accountCap: perAccountCap });
        }
      }
    }
  }

  /* ---- completed bridge-ins and vault events: per-event awards, capped per wallet per day ---------------- */
  const addrs = [...owner.keys()];
  if (rules.bridge_in.enabled) {
    const ev = await query(
      `select external_id, address, amount, completed_at from chain_events
        where kind = 'bridge_in' and status = 'complete' and completed_at is not null and address = any($1::text[])
        order by completed_at, id`,
      [addrs],
    );
    const seen = new Map<string, number>();
    for (const e of ev) {
      if (e.amount == null || Number(e.amount) < rules.bridge_in.minAmountBaseUnits) continue;
      const day = utcDay(e.completed_at);
      const key = `${e.address}|${day}`;
      const rank = (seen.get(key) ?? 0) + 1;
      seen.set(key, rank);
      if (rank > rules.bridge_in.dailyCapPerWallet) continue; // deterministic: only the first N of the day qualify
      guarded.push({ accountId: owner.get(e.address)!.accountId, rule: "bridge_in", ref: e.external_id, points: rules.bridge_in.points, day, address: e.address, detail: { amount: String(e.amount).split(".")[0] }, cap: rules.bridge_in.dailyCapPerWallet });
    }
  }
  if (rules.vault.enabled) {
    const ev = await query(
      `select external_id, address, kind, occurred_at from chain_events
        where kind in ('vault_deposit', 'vault_withdraw') and occurred_at is not null and address = any($1::text[]) and coalesce(amount, 0) >= $2::numeric
        order by occurred_at, id`,
      [addrs, rules.vault.minAmountBaseUnits],
    );
    const seen = new Map<string, number>();
    for (const e of ev) {
      const day = utcDay(e.occurred_at);
      const key = `${e.address}|${day}`;
      const rank = (seen.get(key) ?? 0) + 1;
      seen.set(key, rank);
      if (rank > rules.vault.dailyCapPerWallet) continue;
      guarded.push({ accountId: owner.get(e.address)!.accountId, rule: "vault", ref: e.external_id, points: rules.vault.points, day, address: e.address, detail: { kind: e.kind }, cap: rules.vault.dailyCapPerWallet });
    }
  }

  await insertUnguarded(season, unguarded, out);
  for (const d of txDeltas) await insertTxDelta(season, d, out);
  for (const a of guarded) await insertGuarded(season, a, out);
  return out;
}
