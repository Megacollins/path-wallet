// Solana lane (Phantom) helpers for Rome's v1 lane (rome-sdk-ts v0.3.0): reading a wallet's lane status, and probing what
// the wallet can sign for the lane. Reads only: the probe signs test data and aborts before anything is broadcast.
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ed25519 } from "@noble/curves/ed25519.js";
import { isSyntheticProvisioned, splitV1Wire, submitRomeTxV1, syntheticAddress, type LaneSigner } from "@rome-protocol/sdk";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
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

// ------------------------------------------------------------------ what can the wallet do?
/** works · failed: the wallet itself refused or misbehaved · untested: Rome's builder stopped before the wallet was asked. */
export type Probe = { state: "ok" } | { state: "failed"; error: string } | { state: "untested"; reason: string };
export interface LaneProbe {
  /** The readable "Rome authorization" message: all the relay route needs from the wallet. */
  message: Probe;
  /** A composed Solana v1 transaction: the direct route, and topping up the synthetic's gas. */
  v1Wire: Probe;
}

class ProbeDone extends Error {}
const short = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 260);
const DEAD = "0x000000000000000000000000000000000000dEaD" as const;

/**
 * Find out what a wallet can sign for Rome's lane by running the REAL submit path (nonce, fee sizing, authorization
 * message, Rome's composer, the SDK's own checks of what the composer returned) for a harmless call, and stopping at the
 * last moment: the signer signs the composed v1 transaction, verifies the signature, then aborts, so nothing is ever
 * broadcast. Kept honest about WHO failed: a failure before the wallet was asked is "untested", never blamed on the wallet.
 */
export async function probeLane(cfg: RomeConfig, signer: LaneSigner, opts: { fetchImpl?: typeof fetch; connection?: Connection } = {}): Promise<LaneProbe> {
  let authOk = false;
  let authErr: unknown;
  let wireOk = false;
  let wireErr: unknown;

  const probe: LaneSigner = {
    payer: signer.payer,
    async signAuthHash(message) {
      try {
        const sig = await signer.signAuthHash(message);
        if (!(sig instanceof Uint8Array) || sig.length !== 64) throw new Error(`the wallet returned a ${sig?.length}-byte signature, expected 64`);
        authOk = true;
        return sig;
      } catch (e) {
        authErr = e;
        throw e;
      }
    },
    async signV1Wire(wire) {
      let sig: Uint8Array;
      try {
        sig = await signer.signV1Wire(wire);
      } catch (e) {
        wireErr = e;
        throw e;
      }
      // The same checks the SDK makes after signing: a wallet that re-serialises the transaction signs something else.
      if (!(sig instanceof Uint8Array) || sig.length !== 64) wireErr = new Error(`the wallet returned a ${sig?.length}-byte signature, expected 64`);
      else if (!ed25519.verify(sig, splitV1Wire(wire).message, signer.payer.toBytes())) wireErr = new Error("the wallet signed a different transaction than the one it was given (it may have changed it)");
      else wireOk = true;
      if (wireErr) throw wireErr;
      throw new ProbeDone(); // signed and verified: stop here so nothing is broadcast
    },
  };

  let thrown: unknown;
  try {
    await submitRomeTxV1(
      { connection: opts.connection ?? solanaConnection(cfg), proxyUrl: cfg.proxyUrl, programId: cfg.programId, chainId: cfg.chainId, signer: probe, fetchImpl: opts.fetchImpl },
      { to: cfg.wusdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [DEAD, 1n] }), relayOnRefusal: false },
    );
  } catch (e) {
    thrown = e;
  }

  const stopped = thrown && !(thrown instanceof ProbeDone) ? short(thrown) : "unknown";
  const message: Probe = authErr ? { state: "failed", error: short(authErr) } : authOk ? { state: "ok" } : { state: "untested", reason: `Rome's builder stopped before the message was signed: ${stopped}` };
  const v1Wire: Probe = wireOk
    ? { state: "ok" }
    : wireErr
      ? { state: "failed", error: short(wireErr) }
      : { state: "untested", reason: authErr ? "the message signature failed first" : `Rome's builder stopped before your wallet was asked to sign the transaction: ${stopped}` };
  return { message, v1Wire };
}
