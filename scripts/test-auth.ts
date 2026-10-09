// End-to-end test of the auth API with real signatures, against an in-memory Postgres (PGlite).
// Calls the route handlers directly with Web Request objects — the same code Vercel runs.
//   npm run test:auth
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as challenge from "../api/auth/challenge.js";
import * as verify from "../api/auth/verify.js";
import * as logout from "../api/auth/logout.js";
import * as unlink from "../api/wallets/unlink.js";
import * as me from "../api/me.js";
import * as health from "../api/health.js";
import { query } from "../api/_lib/db.js";
import { syntheticFor } from "../api/_lib/auth.js";

const ORIGIN = "http://localhost:5188";
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

// A browser: holds one session cookie.
class Browser {
  cookie = "";
  async call(handler: (r: Request) => Promise<Response>, path: string, method: "GET" | "POST", body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { host: "localhost:5188", ...extra };
    if (method === "POST") {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      headers.origin = headers.origin ?? ORIGIN;
    }
    if (this.cookie) headers.cookie = this.cookie;
    const res = await handler(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: res.status, data: (await res.json()) as any, setCookie: set };
  }
  challenge(kind: string, address: string, purpose: string) {
    return this.call(challenge.POST, "/api/auth/challenge", "POST", { kind, address, purpose });
  }
  verify(nonce: string, signature: string) {
    return this.call(verify.POST, "/api/auth/verify", "POST", { nonce, signature });
  }
  me() {
    return this.call(me.GET, "/api/me", "GET");
  }
}

// Wallets
const evmKey = generatePrivateKey();
const evm = privateKeyToAccount(evmKey);
const sol = Keypair.generate();
const solAddr = sol.publicKey.toBase58();
const signEvm = (a: typeof evm, message: string) => a.signMessage({ message });
const signSol = (kp: Keypair, message: string) => Buffer.from(ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32))).toString("base64");

async function signIn(b: Browser, kind: "evm" | "solana", who: any) {
  const addr = kind === "evm" ? who.address : who.publicKey.toBase58();
  const c = await b.challenge(kind, addr, "signin");
  const sig = kind === "evm" ? await signEvm(who, c.data.message) : signSol(who, c.data.message);
  return { c, v: await b.verify(c.data.nonce, sig) };
}

const a = new Browser();

// --- health + migrations
const h = await health.GET();
check("health ok on pglite", (await h.json()).db === "pglite" && h.status === 200);

// --- EVM sign-in creates the account
{
  const { c, v } = await signIn(a, "evm", evm);
  check("challenge message names domain, nonce and address", c.data.message.includes("localhost:5188") && c.data.message.includes(c.data.nonce) && c.data.message.includes(evm.address));
  check("evm sign-in creates account + session cookie", v.status === 200 && v.data.account?.wallets?.length === 1 && /HttpOnly/.test(v.setCookie ?? "") && /SameSite=Lax/.test(v.setCookie ?? ""), v);
  check("evm address stored lowercase", v.data.account.wallets[0].address === evm.address.toLowerCase());
  const m = await a.me();
  check("/api/me returns the account", m.data.account?.id === v.data.account.id);
}
const accountA = (await a.me()).data.account.id as string;

// --- linking requires a session, then adds a Solana wallet with its Rome synthetic address
{
  const anon = new Browser();
  const noSession = await anon.challenge("solana", solAddr, "link");
  check("link challenge without a session is refused (401)", noSession.status === 401, noSession);

  const c = await a.challenge("solana", solAddr, "link");
  const v = await a.verify(c.data.nonce, signSol(sol, c.data.message));
  const w = v.data.account?.wallets ?? [];
  check("solana wallet linked to the same account", v.status === 200 && w.length === 2 && v.data.account.id === accountA, v);
  check("solana wallet carries its Rome synthetic address", w.find((x: any) => x.kind === "solana")?.syntheticAddress === syntheticFor(solAddr) && /^0x[0-9a-f]{40}$/.test(syntheticFor(solAddr)));
}

// --- attacks on the challenge
{
  const c = await a.challenge("evm", evm.address, "signin");
  const sig = await signEvm(evm, c.data.message);
  const first = await a.verify(c.data.nonce, sig);
  const replay = await a.verify(c.data.nonce, sig);
  check("a challenge is single-use (replay rejected)", first.status === 200 && replay.status === 400 && replay.data.error === "unknown_challenge", replay);

  const other = privateKeyToAccount(generatePrivateKey());
  const c2 = await new Browser().challenge("evm", evm.address, "signin");
  const forged = await new Browser().verify(c2.data.nonce, await signEvm(other, c2.data.message));
  check("signature from a different key is rejected", forged.status === 401 && forged.data.error === "bad_signature", forged);
  const retry = await new Browser().verify(c2.data.nonce, await signEvm(evm, c2.data.message));
  check("a failed attempt still burns the challenge", retry.status === 400, retry);

  const c3 = await new Browser().challenge("solana", solAddr, "signin");
  const wrongSol = await new Browser().verify(c3.data.nonce, signSol(Keypair.generate(), c3.data.message));
  check("wrong Solana signer is rejected", wrongSol.status === 401, wrongSol);

  const c4 = await new Browser().challenge("evm", evm.address, "signin");
  const tampered = await new Browser().verify(c4.data.nonce, await signEvm(evm, c4.data.message + " "));
  check("a signature over a different message is rejected", tampered.status === 401, tampered);

  const c5 = await new Browser().challenge("evm", evm.address, "signin");
  await query(`update auth_challenges set expires_at = now() - interval '1 minute' where nonce = $1`, [c5.data.nonce]);
  const expired = await new Browser().verify(c5.data.nonce, await signEvm(evm, c5.data.message));
  check("an expired challenge is rejected", expired.status === 400 && expired.data.error === "expired", expired);
}

// --- another browser signs in with the *Solana* wallet and lands in the same account
{
  const b = new Browser();
  const { v } = await signIn(b, "solana", sol);
  check("signing in with the linked Solana wallet reaches the same account", v.data.account?.id === accountA && v.data.account.wallets.length === 2, v);
}

// --- one wallet, one account
{
  const bob = new Browser();
  const bobKey = privateKeyToAccount(generatePrivateKey());
  const { v } = await signIn(bob, "evm", bobKey);
  check("a different wallet gets its own account", v.status === 200 && v.data.account.id !== accountA);
  const c = await bob.challenge("solana", solAddr, "link");
  const steal = await bob.verify(c.data.nonce, signSol(sol, c.data.message));
  check("linking a wallet owned by another account is refused (409)", steal.status === 409 && steal.data.error === "wallet_linked_elsewhere", steal);
  check("…and bob's account is unchanged", (await bob.me()).data.account.wallets.length === 1);

  // A link challenge belongs to the session that asked for it.
  const alice = a;
  const mine = await alice.challenge("evm", bobKey.address, "link");
  const cross = await bob.verify(mine.data.nonce, await signEvm(bobKey, mine.data.message));
  check("a link challenge can't be completed from another session (401)", cross.status === 401 && cross.data.error === "session_changed", cross);
}

// --- request guards
{
  const x = await a.call(challenge.POST, "/api/auth/challenge", "POST", { kind: "evm", address: evm.address, purpose: "signin" }, { origin: "https://evil.example" });
  check("cross-site POST is refused (403)", x.status === 403, x);
  const t = await a.call(challenge.POST, "/api/auth/challenge", "POST", { kind: "evm", address: evm.address, purpose: "signin" }, { "content-type": "text/plain" });
  check("non-JSON POST is refused (415)", t.status === 415, t);
  const bad = await a.challenge("evm", "0x123", "signin");
  check("invalid address is rejected (400)", bad.status === 400, bad);
  const badSol = await a.challenge("solana", "not-a-key", "signin");
  check("invalid Solana address is rejected (400)", badSol.status === 400, badSol);
}

// --- unlink
{
  const u1 = await a.call(unlink.POST, "/api/wallets/unlink", "POST", { kind: "evm", address: evm.address });
  check("unlink a wallet while another remains", u1.status === 200 && u1.data.account.wallets.length === 1 && u1.data.account.wallets[0].kind === "solana", u1);
  const u2 = await a.call(unlink.POST, "/api/wallets/unlink", "POST", { kind: "solana", address: solAddr });
  check("the last wallet can't be unlinked", u2.status === 400 && u2.data.error === "last_wallet", u2);
  const u3 = await new Browser().call(unlink.POST, "/api/wallets/unlink", "POST", { kind: "evm", address: evm.address });
  check("unlink without a session is refused (401)", u3.status === 401, u3);
}

// --- logout kills the session server-side
{
  const old = a.cookie;
  const out = await a.call(logout.POST, "/api/auth/logout", "POST", {});
  check("logout clears the cookie", out.status === 200 && /Max-Age=0/.test(out.setCookie ?? ""));
  const replay = new Browser();
  replay.cookie = old;
  check("the old session token no longer works", (await replay.me()).data.account === null);
  check("sessions store only a hash, never the token", (await query(`select count(*)::int as n from sessions where token_hash = $1`, [old.split("=")[1]]))[0].n === 0);
}

// --- rate limit
{
  const spam = new Browser();
  const addr = privateKeyToAccount(generatePrivateKey()).address;
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await spam.challenge("evm", addr, "signin")).status;
  check("challenge spam for one address is rate-limited (429)", last === 429, last);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
