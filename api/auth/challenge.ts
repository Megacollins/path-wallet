// POST /api/auth/challenge  { kind, address, purpose }  →  { nonce, message, expiresAt }
// The wallet signs `message` exactly as returned, then posts the signature to /api/auth/verify.
import { query } from "../_lib/db.js";
import { CHALLENGE_TTL_MS, buildMessage, fail, guardPost, hostAllowed, hostOf, json, newNonce, normalizeAddress, originOf, readBody, sessionAccount, type Kind, type Purpose } from "../_lib/auth.js";
import { limited, sweepExpired } from "../_lib/limits.js";

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  // A message must name OUR domain: that is what a wallet checks against the page asking for the signature.
  if (!hostAllowed(hostOf(req))) return fail(400, "bad_host", "This host can't be used to sign in.");
  const slow = (await limited(req, "challenge-min", 30, 60_000)) ?? (await limited(req, "challenge-hour", 200, 3_600_000));
  if (slow) return slow;
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

  // Housekeeping now and then (not on every request), then a per-address brake on top of the per-caller limits above.
  if (Math.random() < 0.05) await sweepExpired();
  const recent = await query(`select count(*)::int as n from auth_challenges where kind = $1 and address = $2 and created_at > now() - interval '1 minute'`, [kind, address]);
  if ((recent[0]?.n ?? 0) >= 10) return fail(429, "slow_down", "Too many attempts. Wait a minute.");

  const nonce = newNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  // EVM wallets report the chain they are on; it goes into the EIP-4361 message so the wallet sees nothing unexpected.
  const reported = Number(body?.chainId);
  const chainId = Number.isSafeInteger(reported) && reported > 0 ? reported : 1;
  const message = buildMessage({ origin: originOf(req), kind, address, purpose, nonce, issuedAt, expiresAt, chainId });
  await query(`insert into auth_challenges (nonce, kind, address, purpose, account_id, message, expires_at) values ($1, $2, $3, $4, $5, $6, $7)`, [nonce, kind, address, purpose, accountId, message, expiresAt]);
  return json({ nonce, message, expiresAt: expiresAt.toISOString() });
}
