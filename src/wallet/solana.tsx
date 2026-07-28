// Solana lane (Phantom), via @solana/wallet-adapter-react. A Phantom user drives
// the same Rome contracts with no EVM key — their EVM identity is the synthetic
// address. Writes go through submitRomeTxSolanaLane (lib/rome.ts); this owns
// connection + signing. We drive the adapter programmatically (no modal), so no
// adapter CSS is needed.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
// Import the Phantom adapter directly (not the @solana/wallet-adapter-wallets
// barrel) so we don't bundle every other adapter — notably WalletConnect/@reown.
import { PhantomWalletAdapter, PhantomWalletName } from "@solana/wallet-adapter-phantom";
import type { Transaction } from "@solana/web3.js";
import { cfg } from "../config";

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const adapters = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={cfg.solanaRpc}>
      <WalletProvider wallets={adapters} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

export interface SolanaState {
  available: boolean;
  publicKey: import("@solana/web3.js").PublicKey | null;
  connected: boolean;
  connecting: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  signTransaction: ((tx: Transaction) => Promise<Transaction>) | undefined;
}

export function useSolana(): SolanaState {
  const { select, connect, connected, connecting, publicKey, disconnect, signTransaction, wallet, wallets } = useWallet();
  const [pending, setPending] = useState(false);

  // Phantom is "available" only when actually installed/loadable — the adapter is
  // always registered, so we must check readyState, not mere presence in the list.
  const phantomEntry = wallets.find((w) => w.adapter.name === PhantomWalletName);
  const available =
    phantomEntry?.readyState === WalletReadyState.Installed ||
    phantomEntry?.readyState === WalletReadyState.Loadable ||
    Boolean((window as any).solana?.isPhantom);

  // Selecting a wallet is async; connect once the adapter is ready.
  useEffect(() => {
    if (pending && wallet && !connected && !connecting) {
      connect()
        .catch((e) => console.warn("Phantom connect failed:", e?.message ?? e))
        .finally(() => setPending(false));
    }
  }, [pending, wallet, connected, connecting, connect]);

  const doConnect = useCallback(() => {
    if (!wallet) select(PhantomWalletName);
    setPending(true);
  }, [wallet, select]);

  return {
    available,
    publicKey: publicKey ?? null,
    connected,
    connecting: connecting || pending,
    connect: doConnect,
    disconnect,
    signTransaction: signTransaction as ((tx: Transaction) => Promise<Transaction>) | undefined,
  };
}
