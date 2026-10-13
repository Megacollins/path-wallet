// A Wallet Standard signer for Rome's v1 Solana lane (rome-sdk-ts v0.3.0). The lane needs two signatures from the same
// key: a readable authorization message (`solana:signMessage`) and the composed Solana v1 transaction
// (`solana:signTransaction` over RAW bytes). The legacy wallet adapter hands wallets web3.js Transaction objects, which
// cannot carry the v1 wire format, so this talks to the wallet's Wallet Standard features directly.
//
// Whether a given wallet accepts a v1 wire is not guaranteed (Rome's docs say to check): `probeLaneSupport` finds out,
// without sending anything, so the app can pick a route the wallet can actually use.
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { PublicKey } from "@solana/web3.js";
import type { LaneSigner } from "@rome-protocol/sdk";

type SignMessage = (input: { account: WalletAccount; message: Uint8Array }) => Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
type SignTransaction = (input: { account: WalletAccount; transaction: Uint8Array; chain?: `${string}:${string}` }) => Promise<readonly { signedTransaction: Uint8Array }[]>;
type Connect = (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }>;

const feature = <T,>(wallet: Wallet, name: string, method: string): T | null => {
  const f = (wallet.features as Record<string, Record<string, unknown> | undefined>)[name];
  return (f?.[method] as T | undefined) ?? null;
};

/** The registered Wallet Standard wallets that can sign messages and transactions, Phantom first. */
export function standardSolanaWallets(): Wallet[] {
  return getWallets()
    .get()
    .filter((w) => "solana:signMessage" in w.features && "solana:signTransaction" in w.features)
    .sort((a, b) => Number(/phantom/i.test(b.name)) - Number(/phantom/i.test(a.name)));
}

export interface LaneSignerResult {
  signer: LaneSigner;
  walletName: string;
}

/**
 * A LaneSigner for `publicKey` backed by its Wallet Standard wallet, or null when no standard wallet holds that key
 * (e.g. the wallet isn't connected through Wallet Standard yet). `connect` lets the wallet prompt if it must.
 */
export async function laneSignerFor(publicKey: PublicKey, opts: { connect?: boolean; chain?: `${string}:${string}` } = {}): Promise<LaneSignerResult | null> {
  const address = publicKey.toBase58();
  for (const wallet of standardSolanaWallets()) {
    let account = wallet.accounts.find((a) => a.address === address);
    if (!account) {
      const connect = feature<Connect>(wallet, "standard:connect", "connect");
      if (connect) {
        try {
          account = (await connect({ silent: !opts.connect })).accounts.find((a) => a.address === address);
        } catch {
          /* the user declined, or the wallet can't connect silently: try the next wallet */
        }
      }
    }
    if (!account) continue;
    const signMessage = feature<SignMessage>(wallet, "solana:signMessage", "signMessage")!;
    const signTransaction = feature<SignTransaction>(wallet, "solana:signTransaction", "signTransaction")!;
    const acct = account;
    const signer: LaneSigner = {
      payer: publicKey,
      async signAuthHash(message) {
        const [out] = await signMessage({ account: acct, message });
        return out.signature;
      },
      // Wallet Standard returns the whole signed wire; the lane wants only the 64-byte signature for the empty slot.
      async signV1Wire(wire) {
        const [out] = await signTransaction({ account: acct, transaction: wire, chain: opts.chain ?? "solana:devnet" });
        return out.signedTransaction.slice(-64);
      },
    };
    return { signer, walletName: wallet.name };
  }
  return null;
}

export type ProbeResult = { ok: true } | { ok: false; error: string };
export interface LaneSupport {
  walletName: string;
  /** Can the wallet sign the readable "Rome authorization" message? Enough for the relay route. */
  message: ProbeResult;
  /** Can it sign a composed v1 transaction? Needed for the direct (atomic) route and for topping up gas. */
  v1Wire: ProbeResult;
}

const msg = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 220);

/**
 * Ask the wallet to sign (never send) a harmless message and a real composed v1 wire. `composeWire` is how the caller
 * gets a genuine v1 wire from Rome's composer for this payer; the signature is discarded, so nothing leaves the wallet.
 */
export async function probeLaneSupport(publicKey: PublicKey, composeWire: () => Promise<Uint8Array>): Promise<LaneSupport | null> {
  const found = await laneSignerFor(publicKey, { connect: true });
  if (!found) return null;
  const { signer, walletName } = found;
  const result: LaneSupport = { walletName, message: { ok: false, error: "not tried" }, v1Wire: { ok: false, error: "not tried" } };
  try {
    const sig = await signer.signAuthHash(new TextEncoder().encode("Rome authorization check (nothing is sent)"));
    result.message = sig.length === 64 ? { ok: true } : { ok: false, error: `unexpected signature length ${sig.length}` };
  } catch (e) {
    result.message = { ok: false, error: msg(e) };
  }
  try {
    const sig = await signer.signV1Wire(await composeWire());
    result.v1Wire = sig.length === 64 ? { ok: true } : { ok: false, error: `unexpected signature length ${sig.length}` };
  } catch (e) {
    result.v1Wire = { ok: false, error: msg(e) };
  }
  return result;
}
