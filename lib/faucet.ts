// Core faucet logic — Path's own "starter gas" dispenser. Sends a small amount of
// native USDC (Rome gas) from a treasury account to a claimant, via submitRomeTx.
// Framework-agnostic: the server (server/faucet-server.ts) wraps this with the
// HTTP layer + rate limiting. The treasury key NEVER reaches this from the browser
// — this runs server-side only.
import { isAddress, parseUnits, formatUnits, type Account, type Hex } from "viem";
import { eip1193FromAccount } from "./eip1193Node.js";
import { evmSendNative, publicClient } from "./rome.js";
import type { RomeConfig } from "./config.js";

export interface FaucetResult {
  ok: boolean;
  txHash?: string;
  amountUsdc?: number;
  error?: string;
}

export interface FaucetOpts {
  amountUsdc: number;
  /** Only fund addresses whose gas balance is below this (anti top-up abuse). */
  maxRecipientUsdc: number;
}

/**
 * Dispense starter gas to `recipient`. Gated so it only tops up genuinely-empty
 * wallets, and it verifies the treasury can cover the drip before sending.
 */
export async function dispenseStarterGas(
  cfg: RomeConfig,
  treasury: Account,
  recipient: string,
  opts: FaucetOpts,
): Promise<FaucetResult> {
  if (!isAddress(recipient)) return { ok: false, error: "That doesn't look like a valid 0x address." };
  if (recipient.toLowerCase() === treasury.address.toLowerCase()) return { ok: false, error: "Can't fund the treasury itself." };

  const client = publicClient(cfg);
  const amountWei = parseUnits(String(opts.amountUsdc), 18);

  // Anti-abuse: don't top up an already-funded wallet.
  const recipientBal = await client.getBalance({ address: recipient as Hex });
  const cap = parseUnits(String(opts.maxRecipientUsdc), 18);
  if (recipientBal >= cap) {
    return { ok: false, error: `This wallet already holds ${formatUnits(recipientBal, 18)} USDC gas — the faucet only tops up empty wallets.` };
  }

  // Treasury must be able to cover the drip (+ its own gas for the transfer).
  const treasuryBal = await client.getBalance({ address: treasury.address });
  if (treasuryBal < amountWei + parseUnits("2", 18)) {
    return { ok: false, error: "Faucet treasury is low — please try again later." };
  }

  const provider = eip1193FromAccount(treasury, cfg.proxyUrl, cfg.chainId);
  const txHash = await evmSendNative(provider, treasury.address, recipient as Hex, amountWei);
  return { ok: true, txHash, amountUsdc: opts.amountUsdc };
}
