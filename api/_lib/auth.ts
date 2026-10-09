// Sign-in with a wallet, for both lanes. The server issues a one-time challenge, the wallet signs
// the exact message (no gas, no transaction), the server checks the signature and starts a session.
// EVM: EIP-191 personal_sign, EOAs only. Solana: ed25519 over the UTF-8 message (Phantom signMessage).
// Deliberately free of @solana/web3.js and the Rome SDK: their dependency tree (rpc-websockets → an
// ESM-only uuid) can't be loaded by Vercel's function runtime. Base58, ed25519 verification and the
// synthetic-address hash are small enough to do directly with node:crypto and viem.
import { createHash, createPublicKey, randomBytes, verify as edVerify } from "node:crypto";
import { getAddress, isAddress, keccak256, verifyMessage } from "viem";
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
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  if (!s || s.length > 64) throw new Error("bad base58");
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const body = n === 0n ? [] : [...Buffer.from(hex, "hex")];
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
}

export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  while (zeros < b.length && b[zeros] === 0) zeros++;
  return "1".repeat(zeros) + out;
}

/** Validates and normalizes: EVM → lowercase 0x…, Solana → canonical base58 of a 32-byte key. Null when invalid. */
export function normalizeAddress(kind: Kind, address: unknown): string | null {
  if (typeof address !== "string") return null;
  try {
    if (kind === "evm") return isAddress(address, { strict: false }) ? address.toLowerCase() : null;
    const bytes = base58Decode(address);
    return bytes.length === 32 ? base58Encode(bytes) : null;
  } catch {
    return null;
  }
}

/** A Phantom user's identity inside Rome's EVM (keccak256(pubkey)[12:]): the address the indexer will see their activity under. */
export const syntheticFor = (solanaAddress: string): string => "0x" + keccak256(base58Decode(solanaAddress)).slice(-40);

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

// DER prefix that wraps a raw 32-byte ed25519 public key as an SPKI key node:crypto can load.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

export async function verifySignature(kind: Kind, address: string, message: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== "string" || signature.length > 400) return false;
  try {
    if (kind === "evm") return await verifyMessage({ address: getAddress(address), message, signature: signature as `0x${string}` });
    // Solana: the client sends the 64-byte signature base64-encoded.
    const sig = Buffer.from(signature, "base64");
    if (sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, base58Decode(address)]), format: "der", type: "spki" });
    return edVerify(null, Buffer.from(message, "utf8"), key, sig);
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
