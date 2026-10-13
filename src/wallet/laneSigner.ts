// A Wallet Standard signer for Rome's v1 Solana lane (rome-sdk-ts v0.3.0). The lane needs two signatures from the same
// key: a readable authorization message (`solana:signMessage`) and the composed Solana v1 transaction
// (`solana:signTransaction` over RAW bytes). The legacy wallet adapter hands wallets web3.js Transaction objects, which
// cannot carry the v1 wire format, so this talks to the wallet's Wallet Standard features directly.
//
// Whether a given wallet accepts a v1 wire is not guaranteed (Rome's docs say to check): `probeLane` (lib/romeSolana.ts)
// finds out through the real submit path, without sending anything.
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
