// Tests for the Phantom lane's plan + runner (lib/romeLane.ts): which steps an action needs given what is already true on
// chain, that finished steps are skipped (so a half-done run resumes), that a wallet that can't afford it is refused BEFORE
// anything moves, and that a failure stops the run with an honest message.
//   npm run test:flow
import type { Hex } from "viem";
import { GAS_PER_CALL_WEI, LaneBlocked, LaneNotice, MIN_LANE_LAMPORTS, PENDING_GIVE_UP_MS, planLane, runLane, settlePending, signatureFromSdkError, type LaneFacts, type LaneOps, type PlanInput } from "../lib/romeLane.js";
import { browserGuard, memoryGuard } from "../lib/laneGuard.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() + "n" : v))}`);
  if (!ok) failures++;
};

const A = "0x1111111111111111111111111111111111111111" as Hex;
const call = (label: string) => ({ label, to: A, data: "0x" as Hex });
const facts = (over: Partial<LaneFacts["status"]> = {}, wrapper: LaneFacts["wrapper"] = "ready", walletAta = true): LaneFacts => ({
  status: { synthetic: A, lamports: 5_000_000_000n, walletUsdc: 100_000_000n, provisioned: true, gasWei: 10n * GAS_PER_CALL_WEI, syntheticWusdc: 0n, ...over },
  wrapper,
  walletAta,
});
const deposit = (amount: bigint, grant = true): PlanInput => ({ fund: amount, needsGrant: true, grantCall: grant ? call("grant") : null, calls: [call("approve"), call("deposit")] });
const withdraw = (amount: bigint): PlanInput => ({ fund: 0n, needsGrant: false, calls: [call("withdraw")], sweep: { amount, call: call("sweep") } });
const ids = (steps: { id: string }[]) => steps.map((s) => s.id).join(",");
const blocked = (fn: () => unknown) => {
  try { fn(); return null; } catch (e) { return e instanceof LaneBlocked ? e.message : "NOT-A-LaneBlocked: " + String(e); }
};

/* ---------------------------------------------------------------- the plans */
check("a ready, set-up wallet deposits with just fund → approve → deposit", ids(planLane(facts(), deposit(5_000_000n))) === "fund,call,call");
check("a brand-new wallet does everything once: setup, gas, fund, grant, approve, deposit", ids(planLane(facts({ provisioned: false, gasWei: 0n }, "needs_grant"), deposit(5_000_000n))) === "setup,gas,fund,grant,call,call");
check("…the grant comes after the fund (it needs the synthetic's token account) and before the calls", (() => {
  const s = ids(planLane(facts({ provisioned: false, gasWei: 0n }, "needs_grant"), deposit(5_000_000n))).split(",");
  return s.indexOf("fund") < s.indexOf("grant") && s.indexOf("grant") < s.indexOf("call");
})());
check("gas is only topped up by what is missing (grant+approve+deposit = 3 calls)", (() => {
  const g = planLane(facts({ gasWei: GAS_PER_CALL_WEI }, "needs_grant"), deposit(1_000_000n)).find((s) => s.id === "gas");
  return g?.amount === 2n * GAS_PER_CALL_WEI;
})());
check("enough gas already: no top-up step", !ids(planLane(facts({ gasWei: 3n * GAS_PER_CALL_WEI }, "needs_grant"), deposit(1_000_000n))).includes("gas"));
check("the gas top-up is a multiple of 1e12 wei (the proxy refuses anything else)", (() => {
  const g = planLane(facts({ gasWei: 12_345_678_901_234n }), deposit(1_000_000n)).find((s) => s.id === "gas");
  return g != null && g.amount! % 1_000_000_000_000n === 0n;
})());
check("USDC already on the synthetic from an earlier run is reused: only the shortfall is moved", (() => {
  const f = planLane(facts({ syntheticWusdc: 3_000_000n }), deposit(5_000_000n)).find((s) => s.id === "fund");
  return f?.amount === 2_000_000n;
})());
check("…and if the synthetic already holds the whole amount, there is no fund step at all", !ids(planLane(facts({ syntheticWusdc: 5_000_000n }), deposit(5_000_000n))).includes("fund"));
check("an already-enabled wrapper has no grant step", !ids(planLane(facts({}, "ready"), deposit(1_000_000n))).includes("grant"));
check("an unreadable wrapper state blocks an action that needs it (never guess 'ready')", /Couldn't check whether wUSDC is enabled/.test(blocked(() => planLane(facts({}, "unknown"), deposit(1_000_000n))) ?? ""));
check("…but a withdraw, which doesn't use the wrapper, isn't held up by it", blocked(() => planLane(facts({}, "unknown"), withdraw(1_000_000n))) === null);
check("withdraw: call then sweep, and no fund or grant", ids(planLane(facts(), withdraw(2_000_000n))) === "call,sweep");
check("withdraw for a wallet with no USDC account creates it before the sweep", ids(planLane(facts({}, "ready", false), withdraw(2_000_000n))) === "call,wallet-account,sweep");
check("the sweep counts as a call for gas (2 calls)", planLane(facts({ gasWei: 0n }), withdraw(1_000_000n)).find((s) => s.id === "gas")?.amount === 2n * GAS_PER_CALL_WEI);

/* ------------------------------------------------------------ refusals up front */
check("an old wrapper is refused with a plain message", /old wrapper/.test(blocked(() => planLane(facts({}, "legacy"), deposit(1n))) ?? ""));
check("a wallet with no SOL is refused", /SOL/.test(blocked(() => planLane(facts({ lamports: MIN_LANE_LAMPORTS - 1n }), deposit(1_000_000n))) ?? ""));
check("a wallet without enough USDC for the amount is refused, with the numbers", (() => {
  const m = blocked(() => planLane(facts({ walletUsdc: 2_000_000n }), deposit(5_000_000n))) ?? "";
  return /has 2 USDC/.test(m) && /needs 5/.test(m);
})());
check("…USDC for the amount PLUS the gas top-up is required", (() => {
  const m = blocked(() => planLane(facts({ walletUsdc: 5_000_000n, gasWei: 0n }, "needs_grant"), deposit(5_000_000n))) ?? "";
  return /gas top-up/.test(m);
})());
check("a withdraw needs no USDC for the amount (only gas)", blocked(() => planLane(facts({ walletUsdc: 200_000n }), withdraw(5_000_000n))) === null);
check("every refusal says nothing was done", ["legacy", "sol", "usdc"].every((k) => {
  const f = k === "legacy" ? facts({}, "legacy") : k === "sol" ? facts({ lamports: 0n }) : facts({ walletUsdc: 0n });
  return /Nothing was done/.test(blocked(() => planLane(f, deposit(1_000_000n))) ?? "");
}));

/* --------------------------------------------------------------- the runner */
const log: string[] = [];
const ops = (over: Partial<LaneOps> = {}): LaneOps => ({
  setup: async () => void log.push("setup"),
  topUpGas: async (w) => void log.push(`gas:${w}`),
  fund: async (a) => void log.push(`fund:${a}`),
  createWalletAccount: async () => void log.push("wallet-account"),
  call: async (c) => void log.push(`call:${c.to === A ? "x" : "?"}`),
  receipt: async () => "pending",
  ...over,
});

{
  log.length = 0;
  const steps = planLane(facts({ provisioned: false, gasWei: 0n }, "needs_grant"), deposit(5_000_000n));
  const seen: number[] = [];
  await runLane(steps, ops(), (i) => seen.push(i));
  check("the runner performs the steps in plan order", log.join(" ") === `setup gas:${3n * GAS_PER_CALL_WEI} fund:5000000 call:x call:x call:x`, log);
  check("…and reports progress for each step in turn", seen.join(",") === "0,1,2,3,4,5", seen);
}

{
  log.length = 0;
  const steps = planLane(facts({}, "ready"), deposit(5_000_000n));
  let msg = "";
  await runLane(steps, ops({ call: async () => { throw new Error("User rejected the request"); } })).catch((e) => (msg = e.message));
  check("a declined prompt stops the run; the fund step before it was done, and the message says so", log.join(" ") === "fund:5000000" && /1 of 3 steps are done/.test(msg) && /User rejected/.test(msg), { log, msg });
  check("…and tells the user their funds are safe and that trying again continues", /funds are safe/.test(msg) && /trying again continues/.test(msg), msg);
}

{
  log.length = 0;
  let msg = "";
  await runLane(planLane(facts(), deposit(1_000_000n)), ops({ fund: async () => { throw new Error("blockhash expired"); } })).catch((e) => (msg = e.message));
  check("a failure on the very first step says nothing was done yet, and later steps never run", /Nothing was done yet/.test(msg) && log.length === 0, { msg, log });
}

{
  // A half-done run: the funds reached the synthetic, the calls didn't. Re-planning from the new chain state resumes.
  const after = planLane(facts({ syntheticWusdc: 5_000_000n }, "ready"), deposit(5_000_000n));
  check("resuming after a half-done deposit skips the fund step and only does the calls", ids(after) === "call,call", ids(after));
}

/* ------------------------------------------------ H2: an action whose outcome is unknown is never repeated */
{
  const W = "WalletForTests1111111111111111111111111111111";
  // A tiny chain: the deposit lands but its receipt isn't seen in time. The user then taps Deposit again.
  let synthetic = 0n, vault = 0n, wallet = 10_000_000n;
  const guard = memoryGuard();
  const input = (amount: bigint): PlanInput => ({ fund: amount, needsGrant: true, calls: [{ label: "Allow the vault to take it", to: A, data: "0x" }, { label: "Deposit into the vault", to: A, data: "0x" }] });
  const facts = (): LaneFacts => ({ status: { synthetic: A, lamports: 5_000_000_000n, walletUsdc: wallet, provisioned: true, gasWei: 10n * GAS_PER_CALL_WEI, syntheticWusdc: synthetic }, wrapper: "ready", walletAta: true });
  let receiptOf: "success" | "failed" | "pending" = "pending";
  const chainOps = (landsButUnconfirmed: boolean): LaneOps => ({
    setup: async () => {}, topUpGas: async () => {}, createWalletAccount: async () => {},
    fund: async (a) => { wallet -= a; synthetic += a; },
    call: async (c) => {
      if (c.data === "0x" && vault === 0n && synthetic > 0n && landsButUnconfirmed !== undefined) {
        // the second call of the plan is the deposit; the first (approve) moves nothing in this model
      }
      return undefined;
    },
    receipt: async () => receiptOf,
  });
  // One full "tap Deposit": what act() does, with the fake chain.
  const tap = async (unconfirmed: boolean) => {
    const lock = guard.tryLock(W);
    if (!lock) throw new LaneNotice("busy");
    try {
      const ops = chainOps(unconfirmed);
      let depositCalls = 0;
      ops.call = async (c) => {
        // the second call in the plan is the deposit
        depositCalls++;
        if (depositCalls === 2) {
          vault += synthetic; synthetic = 0n;
          if (unconfirmed) return { status: "unknown", hash: "0xabc" };
        }
      };
      await settlePending(W, guard, ops);
      await runLane(planLane(facts(), input(5_000_000n)), ops, undefined, { guard, wallet: W });
    } finally { guard.unlock(W, lock); }
  };

  let msg = "";
  await tap(true).catch((e) => (msg = e.message));
  check("an unconfirmed deposit says 'don't repeat it' (not 'trying again continues')", /don't repeat it/.test(msg) && !/trying again continues/.test(msg), msg);
  check("…and is remembered, with its hash", guard.getPending(W)?.hash === "0xabc" && guard.getPending(W)?.label === "Deposit into the vault");
  check("the deposit did land once", vault === 5_000_000n);

  let retryMsg = "";
  await tap(false).catch((e) => (retryMsg = e.message));
  check("tapping Deposit again while its result is unknown does NOTHING (told to wait), so there is no second deposit", /isn't confirmed yet/.test(retryMsg) && vault === 5_000_000n && wallet === 5_000_000n, { retryMsg, vault, wallet });

  receiptOf = "success";
  let okMsg = "";
  await tap(false).catch((e) => (okMsg = e.message));
  check("once the earlier deposit is seen to have gone through, the app says so and still does not repeat it", /did go through/.test(okMsg) && vault === 5_000_000n && guard.getPending(W) === null, { okMsg, vault });

  // Failed: carry on and act normally.
  guard.setPending(W, { label: "Deposit into the vault", hash: "0xdead", at: Date.now() });
  receiptOf = "failed";
  await tap(false);
  check("if the earlier transaction turns out to have FAILED, the new action goes ahead", vault === 10_000_000n && guard.getPending(W) === null, vault);

  // Never resolves: give up after the transaction can no longer land.
  guard.setPending(W, { label: "Send wUSDC", signature: "x".repeat(88), at: Date.now() - PENDING_GIVE_UP_MS - 1000 });
  receiptOf = "pending";
  await settlePending(W, guard, chainOps(false));
  check("a pending record older than 10 minutes (it can no longer land) is dropped and the user carries on", guard.getPending(W) === null);
  guard.setPending(W, { label: "Send wUSDC", hash: "0x1", at: Date.now() - 60_000 });
  let recent = "";
  await settlePending(W, guard, { receipt: async () => { throw new Error("rpc down"); } }).catch((e) => (recent = e.message));
  check("a status check that itself fails is treated as 'still pending', never as 'safe to repeat'", /isn't confirmed yet/.test(recent) && guard.getPending(W) !== null, recent);
}

{
  const sig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
  check("a Solana send/confirm timeout from the SDK is recognised as 'sent, outcome unknown' and its signature kept", signatureFromSdkError(new Error(`Solana transaction ${sig} not confirmed within 90000 ms`)) === sig && signatureFromSdkError(new Error(`Solana transaction ${sig} may not have been sent: fetch failed`)) === sig);
  check("…but a real failure (declined, refused, failed on chain) is not mistaken for it", signatureFromSdkError(new Error("User rejected the request")) === null && signatureFromSdkError(new Error(`Solana transaction ${sig} failed: {"InstructionError":[0,"Custom"]}`)) === null);
}

{
  const g = memoryGuard();
  const t1 = g.tryLock("w1");
  check("two actions can't run at once for one wallet", t1 !== null && g.tryLock("w1") === null);
  g.unlock("w1", "wrong-token");
  check("…only the holder's token releases it", g.tryLock("w1") === null);
  g.unlock("w1", t1!);
  check("…and it can be taken again once released", g.tryLock("w1") !== null);
  check("a lock for another wallet is independent", g.tryLock("w2") !== null);
  const g2 = memoryGuard();
  g2.tryLock("w", 1);
  await new Promise((r) => setTimeout(r, 15));
  check("a lock that was never released (a crash) expires by itself", g2.tryLock("w") !== null);

  // Two tabs share localStorage.
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const tabA = browserGuard(storage), tabB = browserGuard(storage);
  const a = tabA.tryLock("w");
  check("a second TAB can't take the lock while the first holds it", a !== null && tabB.tryLock("w") === null);
  tabA.unlock("w", a!);
  check("…and can once it's released", tabB.tryLock("w") !== null);
  tabA.setPending("w", { label: "Send wUSDC", hash: "0x9", at: 1 });
  check("an unconfirmed transaction recorded in one tab is seen by the other, and survives a reload", tabB.getPending("w")?.hash === "0x9" && browserGuard(storage).getPending("w")?.hash === "0x9");
  const broken = browserGuard({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
  broken.setPending("w", { label: "x", at: 1 });
  check("with storage blocked the guard still works for the page's lifetime (memory fallback)", broken.getPending("w")?.label === "x" && broken.tryLock("w") !== null && broken.tryLock("w") === null);
}

/* ------------------------------------------------ M7: a failed read is never acted on as if it were zero */
{
  const { laneFacts } = await import("../lib/romeLane.js");
  const { laneStatus } = await import("../lib/romeSolana.js");
  const { PublicKey } = await import("@solana/web3.js");
  const cfg = { chainId: 200010, proxyUrl: "http://127.0.0.1:1/", solanaRpc: "http://127.0.0.1:1", programId: "RPTWwELXAY4KC9ZPHhaxp7Sq1hHtU3HNEgLbSegCcWf", wusdc: "0xBCE339BA4c3a8De3bB8Af1c5539e6ac11dA3112D", usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", explorerUrl: "" } as any;
  const wallet = new PublicKey("5sMAFYHCPnwdHGCDkqasdhz5QpeunGomJmbtukify58U");
  const lenient = await laneStatus(cfg, wallet);
  check("for DISPLAY, unreachable services still show as zeros (the page keeps working)", lenient.lamports === 0n && lenient.walletUsdc === 0n && lenient.gasWei === 0n && lenient.provisioned === false);
  let err = "";
  await laneFacts(cfg, wallet).catch((e) => (err = `${e.constructor.name}: ${e.message}`));
  check("for ACTING, unreachable services stop the action with a clear message and nothing is planned", /^LaneBlocked: Couldn't read your balances/.test(err), err);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
