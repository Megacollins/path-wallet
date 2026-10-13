// Solana lane (Phantom) helpers for Rome's v1 lane (rome-sdk-ts v0.3.0): reading the wallet's lane status, and getting a
// genuine composed v1 wire from Rome's proxy (used to test whether a wallet can sign the format). Reads only; the
// signing and sending live in the flows that use them.
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { isSyntheticProvisioned, syntheticAddress } from "@rome-protocol/sdk";
import type { Hex } from "viem";
import type { RomeConfig } from "./config.js";
import { publicClient, wusdcBalanceOf } from "./rome.js";

export interface LaneStatus {
  synthetic: Hex;
  /** The wallet's SOL, in lamports (Solana fees on the direct route). */
  lamports: bigint;
  /** The wallet's own USDC (SPL, 6 decimals): what it can put to work. */
  walletUsdc: bigint;
  /** Has the synthetic's one-time setup (`create_pda`) run? */
  provisioned: boolean;
  /** The synthetic's native Rome gas balance, in wei (18 decimals): what a relayed call spends. */
  gasWei: bigint;
  /** wUSDC currently sitting on the synthetic (6 decimals). */
  syntheticWusdc: bigint;
}

export const solanaConnection = (cfg: RomeConfig) => new Connection(cfg.solanaRpc, "confirmed");

/** Everything the Solana lane needs to know about a wallet, in parallel. A failed read becomes zero, never an exception. */
export async function laneStatus(cfg: RomeConfig, wallet: PublicKey): Promise<LaneStatus> {
  const connection = solanaConnection(cfg);
  const synthetic = syntheticAddress(wallet);
  const ata = getAssociatedTokenAddressSync(new PublicKey(cfg.usdcMint), wallet);
  const [lamports, walletUsdc, provisioned, gasWei, syntheticWusdc] = await Promise.all([
    connection.getBalance(wallet).then(BigInt).catch(() => 0n),
    connection.getTokenAccountBalance(ata).then((r) => BigInt(r.value.amount)).catch(() => 0n),
    isSyntheticProvisioned(connection, cfg.programId, synthetic).catch(() => false),
    publicClient(cfg).getBalance({ address: synthetic }).catch(() => 0n),
    wusdcBalanceOf(cfg, synthetic).catch(() => 0n),
  ]);
  return { synthetic, lamports, walletUsdc, provisioned, gasWei, syntheticWusdc };
}

/**
 * A genuine v1 wire from Rome's composer (a small gas top-up for `payer`), for testing a wallet's v1 signing. Nothing is
 * sent: the composer only builds it. The payer must already exist on Solana (hold some SOL).
 */
export async function composeProbeWire(cfg: RomeConfig, payer: PublicKey, wei: bigint = 10n ** 16n): Promise<Uint8Array> {
  const res = await fetch(cfg.proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "rome_composeExternalDepositV1", params: [payer.toBase58(), `0x${wei.toString(16)}`] }),
  });
  const body = (await res.json()) as { result?: { transaction: string }; error?: { message?: string } };
  if (!body.result?.transaction) throw new Error(body.error?.message ?? "the composer returned nothing");
  return Uint8Array.from(atob(body.result.transaction), (c) => c.charCodeAt(0));
}
