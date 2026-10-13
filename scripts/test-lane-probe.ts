// Tests for probeLane: what a wallet can sign for Rome's v1 lane, found by running the real submit path and aborting
// before anything is broadcast. The point of the probe is to blame the right party, so the cases that matter most are the
// ones where Rome's builder fails BEFORE the wallet is asked (it must say "not tested", never "your wallet can't").
// The proxy is mocked, including a composer that returns a genuinely valid v1 transaction the SDK's own checks accept.
//   npm run test:probe
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { base58 } from "@scure/base";
import { authHashFor, ed25519AuthMessage, toLaneSigner, type LaneSigner } from "@rome-protocol/sdk";
import { hexToBytes, type Hex } from "viem";
import type { RomeConfig } from "../lib/config.js";
import { probeLane } from "../lib/romeSolana.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const PROGRAM = new PublicKey("RPTWwELXAY4KC9ZPHhaxp7Sq1hHtU3HNEgLbSegCcWf");
const ED25519_PROGRAM = new PublicKey("Ed25519SigVerify111111111111111111111111111");
const cfg: RomeConfig = { chainId: 200010, proxyUrl: "https://rome-mock.test/", solanaRpc: "https://solana-mock.test", programId: PROGRAM.toBase58(), wusdc: "0xBCE339BA4c3a8De3bB8Af1c5539e6ac11dA3112D", usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", explorerUrl: "https://explorer.test" };

/* ----------------------------------------- a valid composed v1 transaction */
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
/** Build the exact wire Rome's composer returns: version 0x81, one signer (the payer), an Ed25519 verifier instruction vouching for the authorization, one Rome instruction carrying the payload. */
function composedWire(payer: PublicKey, rlp: Hex, authSig: Uint8Array, opts: { omitVerifier?: boolean } = {}): string {
  const message = ed25519AuthMessage(authHashFor(rlp));
  const verifier = new Uint8Array(112 + message.length);
  const v = new DataView(verifier.buffer);
  verifier[0] = 1;
  v.setUint16(2, 48, true); // signature offset
  v.setUint16(4, 0xffff, true);
  v.setUint16(6, 16, true); // key offset
  v.setUint16(8, 0xffff, true);
  v.setUint16(10, 112, true); // message offset
  v.setUint16(12, message.length, true);
  v.setUint16(14, 0xffff, true);
  verifier.set(payer.toBytes(), 16);
  verifier.set(authSig, 48);
  verifier.set(message, 112);
  const rome = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, ...hexToBytes(rlp)]);

  const keys = [payer, ED25519_PROGRAM, PROGRAM];
  const ixs = opts.omitVerifier ? [{ prog: 2, data: rome }] : [{ prog: 1, data: verifier }, { prog: 2, data: rome }];
  const head = [0x81, 1, 0, 2, 0, 0, 0, 0, ...new Array(32).fill(7), ixs.length, keys.length];
  const heads = ixs.flatMap((i) => [i.prog, 0, ...u16(i.data.length)]);
  const body = [...head, ...keys.flatMap((k) => [...k.toBytes()]), ...heads, ...ixs.flatMap((i) => [...i.data])];
  const wire = new Uint8Array(body.length + 64); // the empty signature slot sits after the message
  wire.set(body, 0);
  return Buffer.from(wire).toString("base64");
}

/* ------------------------------------------------------------------ mock proxy */
type Composer = "ok" | "no-verifier" | "signer-not-found" | "empty" | "refusal" | "network";
let composer: Composer = "ok";
let prepareFails = false;
const calls: string[] = [];

const mockFetch = (async (_url: any, init?: any) => {
  const { method, params } = JSON.parse(init.body);
  calls.push(method);
  const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });
  const err = (message: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message } }), { headers: { "content-type": "application/json" } });
  if (prepareFails && method === "eth_getTransactionCount") throw new TypeError("fetch failed");
  switch (method) {
    case "eth_getTransactionCount": return ok("0x0");
    case "eth_estimateGas": return ok("0x30d40");
    case "eth_getBlockByNumber": return ok({ baseFeePerGas: "0x1" });
    case "eth_maxPriorityFeePerGas": return ok("0x0");
    case "eth_gasPrice": return ok("0x1");
    case "rome_composeUnsignedAtomicV1": {
      const [rlp, payer, authSigB58] = params as [Hex, string, string];
      if (composer === "network") throw new TypeError("fetch failed");
      if (composer === "signer-not-found") return err("Signer not found, or more than one signer was found");
      if (composer === "empty") return ok(null);
      if (composer === "refusal") return err("external atomic plan requires iterative composition");
      const wire = composedWire(new PublicKey(payer), rlp, base58.decode(authSigB58), { omitVerifier: composer === "no-verifier" });
      return ok({ recentBlockhash: "11111111111111111111111111111111", transaction: wire });
    }
    default: return err(`unexpected method ${method}`);
  }
}) as typeof fetch;

// A Solana connection that must never be asked to send anything: the probe aborts before broadcasting.
let sendAttempts = 0;
const connection = new Connection("http://127.0.0.1:1") as Connection;
(connection as any).sendRawTransaction = async () => {
  sendAttempts++;
  throw new Error("sendRawTransaction must never be called by the probe");
};

/* --------------------------------------------------------------------- wallets */
const kp = Keypair.generate();
const real = toLaneSigner(kp);
let wireAsked = 0;
const wallet = (over: Partial<LaneSigner>): LaneSigner => ({
  payer: kp.publicKey,
  signAuthHash: real.signAuthHash,
  signV1Wire: async (w) => {
    wireAsked++;
    return real.signV1Wire(w);
  },
  ...over,
});
const run = (signer: LaneSigner) => {
  calls.length = 0;
  wireAsked = 0;
  return probeLane(cfg, signer, { fetchImpl: mockFetch, connection });
};
const reset = () => {
  composer = "ok";
  prepareFails = false;
};

/* ----------------------------------------------------------------------- cases */
{
  reset();
  const r = await run(wallet({}));
  check("a capable wallet: message signed AND a real composed v1 transaction signed and verified", r.message.state === "ok" && r.v1Wire.state === "ok", r);
  check("…and the probe never broadcasts (no send, no relay)", sendAttempts === 0 && !calls.includes("rome_relayUnsignedV1"), { sendAttempts, calls });
  check("…the wallet was asked to sign the transaction exactly once", wireAsked === 1, wireAsked);
}

{
  reset();
  const r = await run(wallet({ signV1Wire: async () => { wireAsked++; throw new Error("Unsupported transaction version: 129"); } }));
  check("a wallet that can't read v1: message ok, v1 FAILED with the wallet's own error", r.message.state === "ok" && r.v1Wire.state === "failed" && /Unsupported transaction version/.test((r.v1Wire as any).error), r);
}

{
  reset();
  const r = await run(wallet({ signV1Wire: async (w) => { wireAsked++; const t = w.slice(); t[60] ^= 0xff; return real.signV1Wire(t); } }));
  check("a wallet that signs a DIFFERENT transaction is caught (the signature doesn't match what it was given)", r.v1Wire.state === "failed" && /different transaction/.test((r.v1Wire as any).error), r);
}

{
  reset();
  const r = await run(wallet({ signV1Wire: async () => { wireAsked++; return new Uint8Array(63); } }));
  check("a wallet returning a wrong-length signature fails the v1 check", r.v1Wire.state === "failed" && /63-byte/.test((r.v1Wire as any).error), r);
}

{
  reset();
  const r = await run(wallet({ signAuthHash: async () => { throw new Error("User rejected the request"); } }));
  check("a wallet that rejects the message: message FAILED; v1 untested because the message came first", r.message.state === "failed" && /User rejected/.test((r.message as any).error) && r.v1Wire.state === "untested", r);
  check("…and the composer was never called, nor the wallet asked for a transaction", !calls.includes("rome_composeUnsignedAtomicV1") && wireAsked === 0, { calls, wireAsked });
}

{
  reset();
  composer = "signer-not-found";
  const r = await run(wallet({}));
  check("Rome's builder says 'Signer not found' (the failure the first test mistook for the wallet): v1 is UNTESTED, not failed", r.v1Wire.state === "untested" && /Signer not found/.test((r.v1Wire as any).reason), r);
  check("…the message still counts as signed, and the wallet was never asked for the transaction", r.message.state === "ok" && wireAsked === 0, { message: r.message, wireAsked });
}

{
  reset();
  composer = "empty";
  const r = await run(wallet({}));
  check("an empty composer answer is untested, not a wallet failure", r.v1Wire.state === "untested" && /empty result/.test((r.v1Wire as any).reason) && wireAsked === 0, r);
}

{
  reset();
  composer = "refusal";
  const r = await run(wallet({}));
  check("the composer refusing the call (too large for one transaction) is untested, and not relayed", r.v1Wire.state === "untested" && /iterative composition/.test((r.v1Wire as any).reason) && !calls.includes("rome_relayUnsignedV1"), { r, calls });
}

{
  reset();
  composer = "no-verifier";
  const r = await run(wallet({}));
  check("a composed transaction that fails the SDK's safety checks never reaches the wallet (untested, wallet not asked)", r.v1Wire.state === "untested" && /Ed25519/.test((r.v1Wire as any).reason) && wireAsked === 0, r);
}

{
  reset();
  composer = "network";
  const r = await run(wallet({}));
  check("a network failure at the composer is untested, never blamed on the wallet", r.v1Wire.state === "untested" && wireAsked === 0, r);
}

{
  reset();
  prepareFails = true;
  const r = await run(wallet({}));
  check("a failure before the wallet is asked anything leaves BOTH untested", r.message.state === "untested" && r.v1Wire.state === "untested", r);
}

check("across every case, nothing was ever broadcast", sendAttempts === 0, sendAttempts);
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
