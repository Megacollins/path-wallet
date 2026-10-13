// Tests for the wrapped-token handling: the registry override, the one-time grant, and the wrapper-state checks that
// protect the flows. The chain is mocked (no network) so every answer shape can be forced.
//   npm run test:wrappers
import { readFileSync } from "node:fs";
import { decodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import type { RomeConfig } from "../lib/config.js";
import { WRAPPER_OVERRIDES, resolveWrapper } from "../lib/wrappers.js";
import * as rome from "../lib/rome.js";
import { NETWORKS } from "../api/_lib/networks.generated.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  if (!ok) failures++;
};

const OLD_USDC = "0xd4cc34b67c805d472b5a709a22a1037f6b16ef28";
const NEW_USDC = "0xBCE339BA4c3a8De3bB8Af1c5539e6ac11dA3112D";

/* ---------------------------------------------------------------- override */
{
  const r = resolveWrapper(200010, OLD_USDC, "wUSDC");
  check("registry still lists the old wUSDC → the redeployed one is used", r.via === "override" && r.address === NEW_USDC && /old wrapper/.test(r.note ?? ""), r);
  check("…matching is case-insensitive on the registry address", resolveWrapper(200010, OLD_USDC.toUpperCase().replace("0X", "0x"), "wUSDC").via === "override");
  const stale = resolveWrapper(200010, NEW_USDC, "wUSDC");
  check("registry already lists the redeployed address → used as is, with a 'delete the override' note", stale.via === "stale-override" && stale.address === NEW_USDC && /delete the override/.test(stale.note ?? ""), stale);
  const third = resolveWrapper(200010, "0x1111111111111111111111111111111111111111", "wUSDC");
  check("registry moves to a THIRD address → the registry wins and the build says to re-check", third.via === "registry" && third.address === "0x1111111111111111111111111111111111111111" && /re-check/.test(third.note ?? ""), third);
  check("a chain with no overrides is untouched", resolveWrapper(999, OLD_USDC, "wUSDC").via === "registry");
  check("an unrelated token on a known chain is untouched and silent", (() => { const x = resolveWrapper(200010, "0x2222222222222222222222222222222222222222", "wBTC"); return x.via === "registry" && x.note === undefined; })());
  const everyChain = Object.entries(WRAPPER_OVERRIDES);
  check("the table covers wUSDC, wETH and wSOL on both chains", everyChain.length === 2 && everyChain.every(([, t]) => Object.values(t).map((o) => o.symbol).sort().join() === "wETH,wSOL,wUSDC"), everyChain.map(([c, t]) => [c, Object.keys(t).length]));
  check("override keys are lowercase and none maps to itself", everyChain.every(([, t]) => Object.entries(t).every(([old, o]) => old === old.toLowerCase() && old !== o.use.toLowerCase() && /^0x[0-9a-fA-F]{40}$/.test(o.use))));
}

/* --------------------------------------------- the generated config is clean */
{
  const generated = JSON.parse(readFileSync(new URL("../src/config.generated.json", import.meta.url), "utf8")) as { networks: { chainId: number; wusdc: string; tokens: { address: string; kind: string }[] }[] };
  const oldAddresses = new Set(Object.values(WRAPPER_OVERRIDES).flatMap((t) => Object.keys(t)));
  const leaked = generated.networks.flatMap((n) => n.tokens.filter((t) => oldAddresses.has(t.address.toLowerCase())).map((t) => t.address));
  check("the app's generated config contains no old wrapper address", leaked.length === 0, leaked);
  check("cfg.wusdc is the redeployed wrapper on every chain", generated.networks.every((n) => Object.values(WRAPPER_OVERRIDES[n.chainId] ?? {}).some((o) => o.use.toLowerCase() === n.wusdc.toLowerCase())), generated.networks.map((n) => n.wusdc));
  check("the API's network snapshot uses the same wUSDC", NETWORKS.every((n) => Object.values(WRAPPER_OVERRIDES[n.chainId] ?? {}).some((o) => o.use.toLowerCase() === n.wusdc.toLowerCase())), NETWORKS.map((n) => n.wusdc));
}

/* ------------------------------------------------------------- grant calldata */
{
  const mint = "0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7" as const;
  const call = rome.buildGrantCall(NEW_USDC, mint);
  check("the grant goes to the Helper precompile (0xFF…09)", call.to === "0xff00000000000000000000000000000000000009" && rome.HELPER === call.to);
  check("…with the approve_spl(address,uint64,bytes32) selector", call.data.slice(0, 10) === keccak256(toHex("approve_spl(address,uint64,bytes32)")).slice(0, 10), call.data.slice(0, 10));
  const d = decodeFunctionData({ abi: parseAbi(["function approve_spl(address spender, uint64 amount, bytes32 mint)"]), data: call.data });
  check("…granting the wrapper the maximum amount over the wrapper's own mint", String(d.args?.[0]).toLowerCase() === NEW_USDC.toLowerCase() && d.args?.[1] === 2n ** 64n - 1n && d.args?.[2] === mint, d.args);
}

/* ------------------------------------------------------- wrapper state checks */
const cfg: RomeConfig = { chainId: 200010, proxyUrl: "https://rome-mock.test/", solanaRpc: "https://solana-mock.test", programId: "RomeProgram", wusdc: NEW_USDC, usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", explorerUrl: "https://explorer.test" };
const USER = "0x1111111111111111111111111111111111111111" as const;
const word = (n: number) => "0x" + n.toString(16).padStart(64, "0");
let mode: "true" | "false" | "revert" | "http500" | "network" | "mint" = "true";

globalThis.fetch = (async (_input: any, init?: any) => {
  const { method, params } = JSON.parse(init.body);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (mode === "network") throw new TypeError("fetch failed");
  if (mode === "http500") return json({}, 500);
  if (method === "eth_call") {
    const data: string = params[0].data;
    if (mode === "revert") return json({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted", data: "0x" } });
    if (data.startsWith("0xe132a122")) return json({ jsonrpc: "2.0", id: 1, result: "0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7" }); // mint_id()
    return json({ jsonrpc: "2.0", id: 1, result: word(mode === "true" ? 1 : 0) }); // isEnabled(user)
  }
  return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } });
}) as typeof fetch;

{
  mode = "true";
  check("isEnabled = true → ready", (await rome.wrapperState(cfg, USER)) === "ready");
  mode = "false";
  check("isEnabled = false → needs_grant", (await rome.wrapperState(cfg, USER)) === "needs_grant");
  mode = "revert";
  check("an empty revert (an old wrapper has no isEnabled) → legacy", (await rome.wrapperState(cfg, USER, OLD_USDC)) === "legacy");
  mode = "network";
  check("a network failure says nothing about the token → unknown (never legacy)", (await rome.wrapperState(cfg, USER)) === "unknown");
  mode = "http500";
  check("an HTTP 500 → unknown (never legacy)", (await rome.wrapperState(cfg, USER)) === "unknown");

  mode = "revert";
  check("wrapperBlocked: a legacy wrapper is blocked with the plain-English reason", (await rome.wrapperBlocked(cfg, USER, OLD_USDC)) === rome.LEGACY_WRAPPER_MESSAGE);
  mode = "false";
  check("wrapperBlocked: a not-yet-granted wrapper is NOT blocked (the grant is the fix, and withdrawals don't need it)", (await rome.wrapperBlocked(cfg, USER)) === null);
  mode = "true";
  check("wrapperBlocked: a ready wrapper is not blocked", (await rome.wrapperBlocked(cfg, USER)) === null);
  mode = "network";
  check("wrapperBlocked: network trouble never blocks a user", (await rome.wrapperBlocked(cfg, USER)) === null);

  mode = "false";
  check("Phantom lane: a wrapper that needs the grant is blocked up front (it can't send one yet)", (await rome.solanaWrapperBlocked(cfg, USER)) === rome.SOLANA_GRANT_MESSAGE);
  mode = "revert";
  check("Phantom lane: a legacy wrapper is blocked", (await rome.solanaWrapperBlocked(cfg, USER, OLD_USDC)) === rome.LEGACY_WRAPPER_MESSAGE);
  mode = "true";
  check("Phantom lane: a ready wrapper is allowed", (await rome.solanaWrapperBlocked(cfg, USER)) === null);
  mode = "network";
  check("Phantom lane: network trouble never blocks", (await rome.solanaWrapperBlocked(cfg, USER)) === null);
}

/* ------------------------------------------------- grant error translation */
{
  mode = "mint";
  // A wallet that has never held the token has no token account to put a delegate on: Solana answers InvalidAccountData.
  const provider = { request: async () => { throw new Error("Execution reverted with reason: SimulateTransactionError: mollusk error: Failure(InvalidAccountData) [program Tokenkeg (SPL Token)]."); } };
  let msg = "";
  try { await rome.grantWrapper(provider as any, USER, cfg, NEW_USDC, "wUSDC"); } catch (e: any) { msg = String(e?.message ?? e); }
  check("a grant for a token the wallet has never held explains itself in plain English", /hold some wUSDC before it can be enabled/.test(msg) && /Nothing was spent/.test(msg), msg.slice(0, 200));
  const other = { request: async () => { throw new Error("user rejected the request"); } };
  let msg2 = "";
  try { await rome.grantWrapper(other as any, USER, cfg, NEW_USDC, "wUSDC"); } catch (e: any) { msg2 = String(e?.message ?? e); }
  check("any other failure (e.g. the user rejecting) passes through unchanged", /rejected/.test(msg2) && !/hold some/.test(msg2), msg2.slice(0, 120));
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
