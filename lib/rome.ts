// The dual-lane core. Both lanes act on the SAME Vault + the SAME wUSDC wrapper.
// Every function is environment-agnostic — the demo/deploy scripts feed a Node
// signer, the web app feeds an injected wallet (window.ethereum / window.solana).
import {
  submitRomeTx,
  submitRomeTxSolanaLane,
  syntheticAddress,
  buildFundLeg,
  buildSweepLeg,
  submitSolanaInstructions,
} from "@rome-protocol/sdk";
import { createPublicClient, http, encodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import type { RomeConfig } from "./config.js";

export const VAULT_ABI = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function totalDeposits() view returns (uint256)",
]);

// Withdraw precompile (0x42..16): `withdraw_to_ata` wraps native gas (USDC) into
// the wUSDC wrapper — how a MetaMask user gets wUSDC to spend.
const WITHDRAW = "0x4200000000000000000000000000000000000016" as const;
const WITHDRAW_ABI = parseAbi(["function withdraw_to_ata(uint256 wei_)"]);

type Eip1193 = { request: (args: { method: string; params?: any[] }) => Promise<any> };
type SolSigner = (tx: Transaction) => Promise<Transaction>;

// ------------------------------ reads (either lane) ------------------------------
export function publicClient(cfg: RomeConfig) {
  return createPublicClient({ transport: http(cfg.proxyUrl) });
}
export function vaultBalanceOf(cfg: RomeConfig, vault: Hex, who: Hex): Promise<bigint> {
  return publicClient(cfg).readContract({ address: vault, abi: VAULT_ABI, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
}
export function wusdcBalanceOf(cfg: RomeConfig, who: Hex): Promise<bigint> {
  return publicClient(cfg).readContract({ address: cfg.wusdc, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
}

// ------------------------------ wrapped tokens: the one-time grant ------------------------------
// Rome's SPL wrappers (wUSDC / wETH / wSOL) move a wallet's tokens as that wallet's SPL *delegate*, so each wallet must
// send ONE grant per wrapper before the wrapper can transfer for it: `approve_spl(wrapper, 2^64-1, mint)` straight to
// the Helper precompile. `wrapper.isEnabled(user)` says whether that has happened. The OLD wrappers (still listed by the
// registry; see lib/wrappers.ts) have no `isEnabled` and revert on every approve/transfer since Rome's 2026-10-02
// release. Wrapping gas USDC into wUSDC and the ERC-20 allowance (`approve`) don't need the grant; moving the tokens does.
export const HELPER = "0xff00000000000000000000000000000000000009" as const;
const WRAPPER_ABI = parseAbi(["function isEnabled(address user) view returns (bool)", "function mint_id() view returns (bytes32)"]);
const HELPER_ABI = parseAbi(["function approve_spl(address spender, uint64 amount, bytes32 mint)"]);
const U64_MAX = 2n ** 64n - 1n;

export const LEGACY_WRAPPER_MESSAGE =
  "This wrapped token is Rome's old version, which can no longer move tokens (a change in Rome's 2 Oct release). Nothing was spent. It needs Rome's redeployed wrapper.";
export const SOLANA_GRANT_MESSAGE =
  "Wrapped tokens need a one-time enable from your wallet, and that step isn't supported from Phantom yet. Use MetaMask for this for now. Nothing was spent.";

/** The calldata of the one-time grant. Pure, so it can be tested without a chain. */
export function buildGrantCall(wrapper: Hex, mint: Hex): { to: Hex; data: Hex } {
  return { to: HELPER, data: encodeFunctionData({ abi: HELPER_ABI, functionName: "approve_spl", args: [wrapper, U64_MAX, mint] }) };
}

/**
 * ready: can move this wallet's tokens · needs_grant: new wrapper, grant not sent yet · legacy: old wrapper (no
 * `isEnabled`), can't move tokens at all · unknown: couldn't tell (network trouble is never treated as a verdict).
 */
export type WrapperState = "ready" | "needs_grant" | "legacy" | "unknown";

export async function wrapperState(cfg: RomeConfig, user: Hex, token: Hex = cfg.wusdc): Promise<WrapperState> {
  try {
    const on = await publicClient(cfg).readContract({ address: token, abi: WRAPPER_ABI, functionName: "isEnabled", args: [user] });
    return on ? "ready" : "needs_grant";
  } catch (e: any) {
    // A wrapper without `isEnabled` answers with an empty revert. Anything else (timeouts, HTTP errors) says nothing about the token.
    return /revert/i.test(`${e?.shortMessage ?? ""} ${e?.message ?? ""}`) ? "legacy" : "unknown";
  }
}

/** Why a flow that only needs a working wrapper (not the grant) must not start; null when it may. */
export async function wrapperBlocked(cfg: RomeConfig, user: Hex, token: Hex = cfg.wusdc): Promise<string | null> {
  return (await wrapperState(cfg, user, token)) === "legacy" ? LEGACY_WRAPPER_MESSAGE : null;
}

/** Phantom lane: the grant can't be sent from there yet, so anything that must MOVE the synthetic's tokens is blocked up front. */
export async function solanaWrapperBlocked(cfg: RomeConfig, synthetic: Hex, token: Hex = cfg.wusdc): Promise<string | null> {
  const st = await wrapperState(cfg, synthetic, token);
  return st === "legacy" ? LEGACY_WRAPPER_MESSAGE : st === "needs_grant" ? SOLANA_GRANT_MESSAGE : null;
}

/** EVM lane: send the one-time grant for `token` and wait until the wrapper reports it. */
export async function grantWrapper(provider: Eip1193, from: Hex, cfg: RomeConfig, token: Hex = cfg.wusdc, symbol = "this token"): Promise<void> {
  const mint = (await publicClient(cfg).readContract({ address: token, abi: WRAPPER_ABI, functionName: "mint_id" })) as Hex;
  try {
    await submitRomeTx(provider, { from, ...buildGrantCall(token, mint) });
  } catch (e: any) {
    // The grant sets a delegate on the wallet's token account, which only exists once the wallet has held the token.
    if (/InvalidAccountData/i.test(`${e?.shortMessage ?? ""} ${e?.message ?? ""}`)) {
      throw new Error(`You need to hold some ${symbol} before it can be enabled (your wallet has no ${symbol} account yet). Nothing was spent.`);
    }
    throw e;
  }
  for (let i = 0; i < 6; i++) {
    if ((await wrapperState(cfg, from, token)) === "ready") return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("The enable transaction was sent but the token still isn't enabled. Give it a moment and try again.");
}

// ------------------------------ EVM lane (MetaMask) ------------------------------
// A MetaMask user has native gas (USDC). `evmWrapToWusdc` turns some into the
// wUSDC wrapper (18-dec `weiAmount` in, 6-dec wUSDC out); then it's a normal
// ERC-20 approve → deposit → withdraw, each via `submitRomeTx`.
export function evmWrapToWusdc(provider: Eip1193, from: Hex, weiAmount: bigint) {
  return submitRomeTx(provider, { from, to: WITHDRAW, data: encodeFunctionData({ abi: WITHDRAW_ABI, functionName: "withdraw_to_ata", args: [weiAmount] }) });
}
export function evmApprove(provider: Eip1193, from: Hex, cfg: RomeConfig, vault: Hex, amount: bigint) {
  return submitRomeTx(provider, { from, to: cfg.wusdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, amount] }) });
}
export function evmDeposit(provider: Eip1193, from: Hex, vault: Hex, amount: bigint) {
  return submitRomeTx(provider, { from, to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [amount] }) });
}
export function evmWithdraw(provider: Eip1193, from: Hex, vault: Hex, amount: bigint) {
  return submitRomeTx(provider, { from, to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [amount] }) });
}

// ------------------------------ Solana lane (Phantom) ------------------------------
// A Phantom user drives the same Vault with no EVM key. Their EVM identity is the
// synthetic address; their spendable balance is the wallet ATA, surfaced as wUSDC.
// The synthetic holds nothing at rest — value flows through it (fund → act → sweep).
export function syntheticFor(payer: PublicKey): Hex {
  return syntheticAddress(payer);
}
function laneDeps(cfg: RomeConfig, payer: PublicKey, signTransaction: SolSigner) {
  return { connection: new Connection(cfg.solanaRpc, "confirmed"), proxyUrl: cfg.proxyUrl, programId: cfg.programId, chainId: cfg.chainId, payer, signTransaction };
}
/** Fund leg: move `amount` (6-dec) of USDC from the wallet into the synthetic's token account. */
export function solanaFund(cfg: RomeConfig, payer: PublicKey, signTransaction: SolSigner, amount: bigint) {
  const synthetic = syntheticAddress(payer);
  return submitSolanaInstructions(
    buildFundLeg({ programId: cfg.programId, chainId: cfg.chainId, mint: new PublicKey(cfg.usdcMint), amount, wallet: payer, synthetic }),
    { connection: new Connection(cfg.solanaRpc, "confirmed"), feePayer: payer, signTransaction },
  );
}
// The first lane write auto-provisions the synthetic (create_pda) — handled by the SDK.
export function solanaApprove(cfg: RomeConfig, payer: PublicKey, signTransaction: SolSigner, vault: Hex, amount: bigint) {
  return submitRomeTxSolanaLane(laneDeps(cfg, payer, signTransaction), { to: cfg.wusdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, amount] }) });
}
export function solanaDeposit(cfg: RomeConfig, payer: PublicKey, signTransaction: SolSigner, vault: Hex, amount: bigint) {
  return submitRomeTxSolanaLane(laneDeps(cfg, payer, signTransaction), { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [amount] }) });
}
export function solanaWithdraw(cfg: RomeConfig, payer: PublicKey, signTransaction: SolSigner, vault: Hex, amount: bigint) {
  return submitRomeTxSolanaLane(laneDeps(cfg, payer, signTransaction), { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [amount] }) });
}
/** Sweep leg: push `amount` (6-dec) of wUSDC from the synthetic back to the wallet, so it holds nothing at rest. */
export async function solanaSweep(cfg: RomeConfig, payer: PublicKey, signTransaction: SolSigner, amount: bigint) {
  const synthetic = syntheticAddress(payer);
  const connection = new Connection(cfg.solanaRpc, "confirmed");
  const sweep = buildSweepLeg({ programId: cfg.programId, mint: new PublicKey(cfg.usdcMint), amount, wallet: payer, synthetic });
  await submitSolanaInstructions([sweep.ensureWalletAtaIx], { connection, feePayer: payer, signTransaction });
  return submitRomeTxSolanaLane(laneDeps(cfg, payer, signTransaction), { to: sweep.helperTo, data: sweep.calldata, extraAccounts: sweep.extraAccounts });
}

// ------------------------------ transfers (Send) ------------------------------
// Path's Send flow. EVM lane sends any token (native gas or ERC-20). The Solana
// lane sends the gas-mint wrapper (wUSDC): fund the synthetic from the wallet,
// then transfer out — value flows through the synthetic, which holds nothing at rest.

/** EVM lane: send native gas (USDC, 18-dec `weiAmount`) to `to`. Costs ~1.48M gas. */
export function evmSendNative(provider: Eip1193, from: Hex, to: Hex, weiAmount: bigint) {
  return submitRomeTx(provider, { from, to, data: "0x", value: weiAmount });
}

/** EVM lane: send an ERC-20 (e.g. wUSDC) to `to`. */
export function evmSendErc20(provider: Eip1193, from: Hex, token: Hex, to: Hex, amount: bigint) {
  return submitRomeTx(provider, { from, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) });
}

/**
 * Solana lane: send the gas-mint wrapper (wUSDC) to an EVM recipient. Fund the
 * synthetic from the wallet, then transfer from the synthetic to `to`.
 * `amount` is 6-dec wUSDC base units; the fund leg uses the same mint amount.
 */
export async function solanaSendWusdc(cfg: RomeConfig, payer: PublicKey, signTransaction: SolSigner, to: Hex, amount: bigint) {
  await solanaFund(cfg, payer, signTransaction, amount);
  return submitRomeTxSolanaLane(laneDeps(cfg, payer, signTransaction), {
    to: cfg.wusdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
  });
}
