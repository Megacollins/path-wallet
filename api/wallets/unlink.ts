// POST /api/wallets/unlink { kind, address } → { account }. An account always keeps at least one wallet.
import { query } from "../_lib/db.js";
import { accountView, fail, guardPost, json, normalizeAddress, readBody, sessionAccount, type Kind } from "../_lib/auth.js";

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  const accountId = await sessionAccount(req);
  if (!accountId) return fail(401, "not_signed_in", "Sign in first.");
  const body = await readBody(req);
  const kind = body?.kind as Kind;
  if (kind !== "evm" && kind !== "solana") return fail(400, "bad_kind", "kind must be evm or solana.");
  const address = normalizeAddress(kind, body?.address);
  if (!address) return fail(400, "bad_address", "That isn't a valid address.");

  const total = (await query(`select count(*)::int as n from wallets where account_id = $1`, [accountId]))[0]?.n ?? 0;
  if (total <= 1) return fail(400, "last_wallet", "That's your only wallet. An account needs at least one.");
  const gone = await query(`delete from wallets where account_id = $1 and kind = $2 and address = $3 returning id`, [accountId, kind, address]);
  if (!gone[0]) return fail(404, "not_linked", "That wallet isn't linked to your account.");
  return json({ account: await accountView(accountId) });
}
