// POST /api/auth/verify  { nonce, signature }  →  { account }
// signin: creates the account on first sight of a wallet, then starts a session.
// link:   adds the wallet to the signed-in account. A wallet belongs to exactly one account.
import { randomUUID } from "node:crypto";
import { query } from "../_lib/db.js";
import { MAX_WALLETS_PER_KIND, accountView, fail, guardPost, json, readBody, sessionAccount, startSession, syntheticFor, verifySignature, type Kind } from "../_lib/auth.js";

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await readBody(req);
  if (typeof body?.nonce !== "string" || typeof body?.signature !== "string") return fail(400, "bad_request", "nonce and signature are required.");

  // A challenge is single-use: consume it before doing anything else, so a replay finds nothing.
  const rows = await query(`delete from auth_challenges where nonce = $1 returning kind, address, purpose, account_id, message, expires_at`, [body.nonce]);
  const ch = rows[0];
  if (!ch) return fail(400, "unknown_challenge", "That sign-in request is unknown or already used. Try again.");
  if (new Date(ch.expires_at).getTime() < Date.now()) return fail(400, "expired", "That sign-in request expired. Try again.");

  const kind = ch.kind as Kind;
  const address = ch.address as string;
  if (!(await verifySignature(kind, address, ch.message, body.signature))) return fail(401, "bad_signature", "The signature doesn't match that wallet.");

  const synthetic = kind === "solana" ? syntheticFor(address) : null;
  const existing = (await query(`select account_id from wallets where kind = $1 and address = $2`, [kind, address]))[0]?.account_id as string | undefined;

  if (ch.purpose === "link") {
    const accountId = await sessionAccount(req);
    if (!accountId || accountId !== ch.account_id) return fail(401, "session_changed", "Your session changed. Sign in again.");
    if (existing && existing !== accountId) return fail(409, "wallet_linked_elsewhere", "That wallet is already linked to a different Path account.");
    if (!existing) {
      const n = (await query(`select count(*)::int as n from wallets where account_id = $1 and kind = $2`, [accountId, kind]))[0]?.n ?? 0;
      if (n >= MAX_WALLETS_PER_KIND) return fail(400, "too_many_wallets", `You can link up to ${MAX_WALLETS_PER_KIND} ${kind === "evm" ? "EVM" : "Solana"} wallets.`);
      const ins = await query(`insert into wallets (account_id, kind, address, synthetic_address) values ($1, $2, $3, $4) on conflict (kind, address) do nothing returning id`, [accountId, kind, address, synthetic]);
      if (!ins[0]) return fail(409, "wallet_linked_elsewhere", "That wallet is already linked to a different Path account.");
    }
    return json({ account: await accountView(accountId) });
  }

  // signin
  let accountId = existing;
  if (!accountId) {
    const fresh = randomUUID();
    await query(`insert into accounts (id) values ($1)`, [fresh]);
    const ins = await query(`insert into wallets (account_id, kind, address, synthetic_address) values ($1, $2, $3, $4) on conflict (kind, address) do nothing returning account_id`, [fresh, kind, address, synthetic]);
    if (ins[0]) accountId = fresh;
    else {
      // Lost a race with a parallel first sign-in for this wallet: use theirs, drop the empty account.
      await query(`delete from accounts where id = $1`, [fresh]);
      accountId = (await query(`select account_id from wallets where kind = $1 and address = $2`, [kind, address]))[0]?.account_id;
    }
  }
  if (!accountId) return fail(500, "no_account", "Couldn't create your account. Try again.");
  const cookie = await startSession(req, accountId);
  return json({ account: await accountView(accountId) }, 200, { "set-cookie": cookie });
}
