// GET /api/account/points → the signed-in account's own points: total, per rule, per day, recent entries, and
// the rules in plain English. Devnet points are a test of the system; nothing here promises a reward.
import { fail, json, sessionAccount } from "../_lib/auth.js";
import { query } from "../_lib/db.js";
import { RULES_VERSION, currentSeason, describeRules } from "../_lib/points/rules.js";

export async function GET(req: Request): Promise<Response> {
  const accountId = await sessionAccount(req);
  if (!accountId) return fail(401, "not_signed_in", "Sign in first.");
  const season = currentSeason();

  const [byRule, daily, recent] = await Promise.all([
    query(`select rule, sum(points)::int as points, count(*)::int as entries from points_ledger where account_id = $1 and season = $2 group by rule order by points desc`, [accountId, season]),
    query(
      `select day::text as day, sum(points)::int as points from points_ledger
        where account_id = $1 and season = $2 and day is not null and day >= (now() at time zone 'utc')::date - 29
        group by day order by day desc`,
      [accountId, season],
    ),
    query(`select rule, points, day::text as day, address, created_at from points_ledger where account_id = $1 and season = $2 order by id desc limit 30`, [accountId, season]),
  ]);
  return json({
    season,
    rulesVersion: RULES_VERSION,
    total: byRule.reduce((s, r) => s + Number(r.points), 0),
    byRule: byRule.map((r) => ({ rule: r.rule, points: Number(r.points), entries: Number(r.entries) })),
    daily: daily.map((d) => ({ day: d.day, points: Number(d.points) })),
    recent: recent.map((r) => ({ rule: r.rule, points: Number(r.points), day: r.day, address: r.address, at: new Date(r.created_at).toISOString() })),
    rules: describeRules(),
  });
}
