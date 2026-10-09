// Sign-in with a wallet, for both lanes. The server issues a one-time challenge, the wallet signs
// the exact message (no gas, no transaction), the server checks the signature and starts a session.
// EVM: EIP-191 personal_sign, EOAs only. Solana: ed25519 over the UTF-8 message (Phantom signMessage).
import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress, verifyMessage } from "viem";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PublicKey } from "@solana/web3.js";
import { syntheticAddress } from "@rome-protocol/sdk";
import { query } from "./db.js";

export type Kind = "evm" | "solana";
export type Purpose = "signin" | "link";

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const COOKIE = "path_session";
export const MAX_WALLETS_PER_KIND = 5;

/* ------------------------------------------------------------------ http */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
export const fail = (status: number, error: string, message?: string) => json({ error, message: message ?? error }, status);

/** The public host the browser used (behind Vercel's proxy the URL itself can carry an internal one). */
export const hostOf = (req: Request) => req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;

/** POST bodies must be same-origin JSON: blocks cross-site form posts riding the session cookie. */
export function guardPost(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).host === hostOf(req);
    } catch {}
    if (!ok) return fail(403, "bad_origin", "Cross-site request refused.");
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(415, "bad_content_type", "Send JSON.");
  return null;
}

export async function readBody(req: Request): Promise<Record<string, any> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

const isSecure = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

function cookieOf(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/* ------------------------------------------------------------- addresses */
/** Validates and normalizes: EVM → lowercase 0x…, Solana → canonical base58. Null when invalid. */
export function normalizeAddress(kind: Kind, address: unknown): string | null {
  if (typeof address !== "string") return null;
  try {
    if (kind === "evm") return isAddress(address, { strict: false }) ? address.toLowerCase() : null;
    return new PublicKey(address).toBase58();
  } catch {
    return null;
  }
}

/** A Phantom user's identity inside Rome's EVM: the address the indexer will see their activity under. */
export const syntheticFor = (solanaAddress: string): string => syntheticAddress(new PublicKey(solanaAddress)).toLowerCase();

/* --------------------------------------------------------------- message */
export function buildMessage(a: { host: string; kind: Kind; address: string; purpose: Purpose; nonce: string; issuedAt: Date; expiresAt: Date }): string {
  const shown = a.kind === "evm" ? getAddress(a.address) : a.address;
  const what =
    a.purpose === "signin"
      ? "Sign in to Path. This costs nothing and sends no transaction."
      : "Link this wallet to your Path account. This costs nothing and sends no transaction.";
  return [
    `Path wants you to sign in with your ${a.kind === "evm" ? "Ethereum" : "Solana"} account:`,
    shown,
    "",
    what,
    "",
    `URI: https://${a.host}`,
    `Nonce: ${a.nonce}`,
    `Issued At: ${a.issuedAt.toISOString()}`,
    `Expiration Time: ${a.expiresAt.toISOString()}`,
  ].join("\n");
}

export async function verifySignature(kind: Kind, address: string, message: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== "string" || signature.length > 400) return false;
  try {
    if (kind === "evm") return await verifyMessage({ address: getAddress(address), message, signature: signature as `0x${string}` });
    // Solana: the client sends the 64-byte signature base64-encoded.
    const sig = Uint8Array.from(Buffer.from(signature, "base64"));
    if (sig.length !== 64) return false;
    return ed25519.verify(sig, new TextEncoder().encode(message), new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export const newNonce = () => randomBytes(16).toString("hex");

/* -------------------------------------------------------------- sessions */
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function startSession(req: Request, accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query(`insert into sessions (token_hash, account_id, expires_at) values ($1, $2, $3)`, [hashToken(token), accountId, new Date(Date.now() + SESSION_TTL_MS)]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${isSecure(req) ? "; Secure" : ""}`;
}

export function clearCookie(req: Request): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? "; Secure" : ""}`;
}

export async function sessionAccount(req: Request): Promise<string | null> {
  const token = cookieOf(req, COOKIE);
  if (!token) return null;
  const rows = await query(`select account_id from sessions where token_hash = $1 and expires_at > now()`, [hashToken(token)]);
  return (rows[0]?.account_id as string) ?? null;
}

export async function endSession(req: Request): Promise<void> {
  const token = cookieOf(req, COOKIE);
  if (token) await query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
}

/* --------------------------------------------------------------- account */
export interface AccountView {
  id: string;
  createdAt: string;
  wallets: { kind: Kind; address: string; syntheticAddress: string | null; linkedAt: string }[];
}

export async function accountView(accountId: string): Promise<AccountView | null> {
  const acc = await query(`select id, created_at from accounts where id = $1`, [accountId]);
  if (!acc[0]) return null;
  const w = await query(`select kind, address, synthetic_address, linked_at from wallets where account_id = $1 order by linked_at, kind`, [accountId]);
  return {
    id: acc[0].id,
    createdAt: new Date(acc[0].created_at).toISOString(),
    wallets: w.map((r) => ({ kind: r.kind, address: r.address, syntheticAddress: r.synthetic_address ?? null, linkedAt: new Date(r.linked_at).toISOString() })),
  };
}
