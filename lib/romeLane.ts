// Doing things from Phantom on Rome's v1 lane: deposit, withdraw, send. An action is a short plan of steps built from what
// is already true on chain, so every step is skipped when it is already done: a run that stopped halfway (declined prompt,
// network) resumes where it left off and nothing is done twice. Value flows through the synthetic:
// wallet → synthetic → action → wallet, so the synthetic holds nothing at rest.
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  buildFundLeg,
  buildSweepLeg,
  fundSyntheticGas,
  provisionSynthetic,
  submitRomeTxV1,
  submitSolanaInstructions,
  syntheticAddress,
  type LaneSigner,
  type SolanaLaneV1Result,
} from "@rome-protocol/sdk";
import { encodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import type { RomeConfig } from "./config.js";
import { VAULT_ABI, buildGrantCall, publicClient, wrapperState, type WrapperState } from "./rome.js";
import { laneStatus, solanaConnection, type LaneStatus } from "./romeSolana.js";

/** A rough allowance of native gas for one Rome call (18-dec wei): ~1.5M gas at today's ~10 gwei, with headroom. */
export const GAS_PER_CALL_WEI = 40_000_000_000_000_000n; // 0.04 USDC
/** Wallet SOL needed to start (Solana fees + rent for the accounts created the first time). */
export const MIN_LANE_LAMPORTS = 10_000_000n; // 0.01 SOL
const WEI_PER_BASE = 1_000_000_000_000n; // gas wei per 6-dec USDC base unit

const short = (e: unknown) => String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as { message?: string })?.message ?? e).slice(0, 240);

export type StepId = "setup" | "gas" | "fund" | "grant" | "call" | "wallet-account" | "sweep";
export interface Step {
  id: StepId;
  label: string;
  /** setup/gas/fund/sweep: the amount involved (gas in wei, the rest in 6-dec USDC). */
  amount?: bigint;
  call?: { to: Hex; data: Hex };
}

export interface LaneFacts {
  status: LaneStatus;
  wrapper: WrapperState;
  /** Does the wallet already have its own USDC token account (where a sweep lands)? */
  walletAta: boolean;
}

export interface PlanInput {
  /** The EVM calls the action makes, in order (the grant and the sweep are added by the planner as needed). */
  calls: { label: string; to: Hex; data: Hex }[];
  /** wUSDC the synthetic must hold before the calls (0 for a withdraw). */
  fund: bigint;
  /** Do the calls move the synthetic's wUSDC (so the one-time wrapper grant is needed)? */
  needsGrant: boolean;
  /** The grant's calldata, supplied when the wrapper needs one. */
  grantCall?: { to: Hex; data: Hex } | null;
  /** Push USDC back to the wallet afterwards. */
  sweep?: { amount: bigint; call: { to: Hex; data: Hex } } | null;
}

export class LaneBlocked extends Error {}

/** Build the plan, or throw a plain-language LaneBlocked if it can't be done. Pure: no network. */
export function planLane(facts: LaneFacts, input: PlanInput): Step[] {
  const { status, wrapper, walletAta } = facts;
  if (wrapper === "legacy") throw new LaneBlocked("This token still uses Rome's old wrapper, which can't move tokens. Nothing was done.");
  const grantNeeded = input.needsGrant && wrapper === "needs_grant";
  const calls = input.calls.length + (grantNeeded ? 1 : 0) + (input.sweep ? 1 : 0);
  const fundNeeded = input.fund > status.syntheticWusdc ? input.fund - status.syntheticWusdc : 0n;
  const gasWanted = BigInt(calls) * GAS_PER_CALL_WEI;
  // The proxy only accepts a top-up in whole 6-dec USDC units (multiples of 1e12 wei), so round the shortfall up.
  const gasShort = gasWanted > status.gasWei ? gasWanted - status.gasWei : 0n;
  const gasNeeded = ((gasShort + WEI_PER_BASE - 1n) / WEI_PER_BASE) * WEI_PER_BASE;

  if (status.lamports < MIN_LANE_LAMPORTS) throw new LaneBlocked("Your Solana wallet needs a little SOL (about 0.01) for network fees. Nothing was done.");
  const usdcNeeded = fundNeeded + gasNeeded / WEI_PER_BASE;
  if (status.walletUsdc < usdcNeeded) {
    throw new LaneBlocked(`Your wallet has ${Number(status.walletUsdc) / 1e6} USDC but this needs ${Number(usdcNeeded) / 1e6}${gasNeeded > 0n ? " (the amount plus a small gas top-up)" : ""}. Nothing was done.`);
  }

  const steps: Step[] = [];
  if (!status.provisioned) steps.push({ id: "setup", label: "Set up your Rome account (one time)" });
  if (gasNeeded > 0n) steps.push({ id: "gas", label: "Top up gas", amount: gasNeeded });
  if (fundNeeded > 0n) steps.push({ id: "fund", label: "Move USDC into your Rome account", amount: fundNeeded });
  if (grantNeeded) {
    if (!input.grantCall) throw new Error("internal: the wrapper needs a grant but no grant call was supplied");
    steps.push({ id: "grant", label: "Enable wUSDC (one time)", call: input.grantCall });
  }
  for (const c of input.calls) steps.push({ id: "call", label: c.label, call: { to: c.to, data: c.data } });
  if (input.sweep) {
    if (!walletAta) steps.push({ id: "wallet-account", label: "Create your USDC account" });
    steps.push({ id: "sweep", label: "Move USDC back to your wallet", amount: input.sweep.amount, call: input.sweep.call });
  }
  return steps;
}

/** What a step does for real. Injected so order and skipping can be tested without a chain or a wallet. */
export interface LaneOps {
  setup(): Promise<void>;
  topUpGas(wei: bigint): Promise<void>;
  fund(amount: bigint): Promise<void>;
  createWalletAccount(): Promise<void>;
  /** An EVM call from the synthetic; must throw if it reverted. */
  call(call: { to: Hex; data: Hex }): Promise<void>;
}

/** Run the plan in order. Stops at the first failure and says what was done and that trying again continues from there. */
export async function runLane(steps: Step[], ops: LaneOps, onStep?: (index: number, step: Step) => void): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    onStep?.(i, step);
    try {
      switch (step.id) {
        case "setup": await ops.setup(); break;
        case "gas": await ops.topUpGas(step.amount!); break;
        case "fund": await ops.fund(step.amount!); break;
        case "wallet-account": await ops.createWalletAccount(); break;
        default: await ops.call(step.call!);
      }
    } catch (e) {
      const done = i === 0 ? "Nothing was done yet." : `${i} of ${steps.length} steps are done.`;
      throw new Error(`"${step.label}" didn't go through: ${short(e)}. ${done} Your funds are safe, and trying again continues from here.`);
    }
  }
}

export interface LaneEnv {
  cfg: RomeConfig;
  wallet: PublicKey;
  signer: LaneSigner;
  /** The wallet adapter's signTransaction: only for the plain Solana transactions (set-up, moving USDC). */
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  connection?: Connection;
  fetchImpl?: typeof fetch;
}

export function realOps(env: LaneEnv): LaneOps {
  const { cfg, wallet } = env;
  const connection = env.connection ?? solanaConnection(cfg);
  const synthetic = syntheticAddress(wallet);
  const mint = new PublicKey(cfg.usdcMint);
  const v1 = { connection, proxyUrl: cfg.proxyUrl, programId: cfg.programId, chainId: cfg.chainId, signer: env.signer, fetchImpl: env.fetchImpl };
  const legacy = { connection, proxyUrl: cfg.proxyUrl, programId: cfg.programId, chainId: cfg.chainId, payer: wallet, signTransaction: env.signTransaction, fetchImpl: env.fetchImpl };
  const confirmed = (r: SolanaLaneV1Result) => {
    if (r.receipt?.status === "0x0") throw new Error("the chain rejected the call (it reverted)");
    if (!r.receipt) throw new Error("it was sent but not confirmed in time; check again in a moment");
  };
  return {
    setup: async () => void (await provisionSynthetic(legacy)),
    topUpGas: async (wei) => void (await fundSyntheticGas(v1, wei)),
    fund: async (amount) =>
      void (await submitSolanaInstructions(buildFundLeg({ programId: cfg.programId, chainId: cfg.chainId, mint, amount, wallet, synthetic }), { connection, feePayer: wallet, signTransaction: env.signTransaction })),
    createWalletAccount: async () => {
      const sweep = buildSweepLeg({ programId: cfg.programId, mint, amount: 1n, wallet, synthetic });
      await submitSolanaInstructions([sweep.ensureWalletAtaIx], { connection, feePayer: wallet, signTransaction: env.signTransaction });
    },
    call: async (c) => confirmed(await submitRomeTxV1(v1, { ...c, relayOnRefusal: false })),
  };
}

/** Read everything the planner needs, in parallel. */
export async function laneFacts(cfg: RomeConfig, wallet: PublicKey, connection: Connection = solanaConnection(cfg)): Promise<LaneFacts> {
  const synthetic = syntheticAddress(wallet);
  const ata = getAssociatedTokenAddressSync(new PublicKey(cfg.usdcMint), wallet);
  const [status, wrapper, walletAta] = await Promise.all([
    laneStatus(cfg, wallet),
    wrapperState(cfg, synthetic, cfg.wusdc),
    connection.getAccountInfo(ata).then((a) => a != null).catch(() => true), // unknown: assume it exists, never block on a flaky read
  ]);
  return { status, wrapper, walletAta };
}

const MINT_ABI = parseAbi(["function mint_id() view returns (bytes32)"]);
async function grantCallFor(cfg: RomeConfig): Promise<{ to: Hex; data: Hex }> {
  const mint = (await publicClient(cfg).readContract({ address: cfg.wusdc, abi: MINT_ABI, functionName: "mint_id" })) as Hex;
  return buildGrantCall(cfg.wusdc, mint);
}

const evm = (label: string, to: Hex, data: Hex) => ({ label, to, data });

export type Progress = (index: number, total: number, step: Step) => void;

async function act(env: LaneEnv, build: (facts: LaneFacts) => PlanInput, onProgress?: Progress): Promise<Step[]> {
  const facts = await laneFacts(env.cfg, env.wallet, env.connection);
  const input = build(facts);
  if (input.needsGrant && facts.wrapper === "needs_grant") input.grantCall = await grantCallFor(env.cfg);
  const steps = planLane(facts, input);
  await runLane(steps, realOps(env), (i, s) => onProgress?.(i, steps.length, s));
  return steps;
}

export function solanaDepositFlow(env: LaneEnv, vault: Hex, amount: bigint, onProgress?: Progress) {
  return act(env, () => ({
    fund: amount,
    needsGrant: true,
    calls: [
      evm("Allow the vault to take it", env.cfg.wusdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, amount] })),
      evm("Deposit into the vault", vault, encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [amount] })),
    ],
  }), onProgress);
}

export function solanaWithdrawFlow(env: LaneEnv, vault: Hex, amount: bigint, onProgress?: Progress) {
  return act(env, (facts) => {
    const total = facts.status.syntheticWusdc + amount; // anything left on the synthetic by an earlier run comes home too
    const leg = buildSweepLeg({ programId: env.cfg.programId, mint: new PublicKey(env.cfg.usdcMint), amount: total, wallet: env.wallet, synthetic: syntheticAddress(env.wallet) });
    return {
      fund: 0n,
      needsGrant: false,
      calls: [evm("Withdraw from the vault", vault, encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [amount] }))],
      sweep: { amount: total, call: { to: leg.helperTo, data: leg.calldata } },
    };
  }, onProgress);
}

export function solanaSendFlow(env: LaneEnv, to: Hex, amount: bigint, onProgress?: Progress) {
  return act(env, () => ({
    fund: amount,
    needsGrant: true,
    calls: [evm("Send wUSDC", env.cfg.wusdc, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }))],
  }), onProgress);
}
