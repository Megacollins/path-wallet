// POST /api/auth/challenge  { kind, address, purpose }  →  { nonce, message, expiresAt }
// The wallet signs `message` exactly as returned, then posts the signature to /api/auth/verify.
import { query } from "../_lib/db.js";
import { CHALLENGE_TTL_MS, buildMessage, fail, guardPost, json, newNonce, normalizeAddress, originOf, readBody, sessionAccount, type Kind, type Purpose } from "../_lib/auth.js";

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await readBody(req);
  const kind = body?.kind as Kind;
  const purpose = body?.purpose as Purpose;
  if (kind !== "evm" && kind !== "solana") return fail(400, "bad_kind", "kind must be evm or solana.");
  if (purpose !== "signin" && purpose !== "link") return fail(400, "bad_purpose", "purpose must be signin or link.");
  const address = normalizeAddress(kind, body?.address);
  if (!address) return fail(400, "bad_address", "That isn't a valid address.");

  // Linking adds a wallet to the account you're already signed in to.
  let accountId: string | null = null;
  if (purpose === "link") {
    accountId = await sessionAccount(req);
    if (!accountId) return fail(401, "not_signed_in", "Sign in first, then link another wallet.");
  }

  // Housekeeping, then a per-address brake so the endpoint can't be used to fill the table.
  await query(`delete from auth_challenges where expires_at < now()`);
  await query(`delete from sessions where expires_at < now()`);
  const recent = await query(`select count(*)::int as n from auth_challenges where kind = $1 and address = $2 and created_at > now() - interval '1 minute'`, [kind, address]);
  if ((recent[0]?.n ?? 0) >= 10) return fail(429, "slow_down", "Too many attempts. Wait a minute.");

  const nonce = newNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = buildMessage({ origin: originOf(req), kind, address, purpose, nonce, issuedAt, expiresAt });
  await query(`insert into auth_challenges (nonce, kind, address, purpose, account_id, message, expires_at) values ($1, $2, $3, $4, $5, $6, $7)`, [nonce, kind, address, purpose, accountId, message, expiresAt]);
  return json({ nonce, message, expiresAt: expiresAt.toISOString() });
}
