// One provider tree, both lanes. `useWallets()` is the single hook the app uses:
// MetaMask (EVM) and Phantom (Solana) connected *simultaneously*, plus the
// derived synthetic address that is the Phantom user's EVM identity on Rome.
import { type ReactNode } from "react";
import type { Hex } from "viem";
import { EvmProvider, useEvm, type EvmState } from "./evm";
import { SolanaWalletProvider, useSolana, type SolanaState } from "./solana";
import { syntheticFor } from "../../lib/rome";

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <EvmProvider>
      <SolanaWalletProvider>{children}</SolanaWalletProvider>
    </EvmProvider>
  );
}

export interface Wallets {
  evm: EvmState;
  solana: SolanaState;
  /** The Phantom user's EVM identity on Rome (keccak256(pubkey)[12:]). */
  synthetic: Hex | null;
  anyConnected: boolean;
  bothConnected: boolean;
}

export function useWallets(): Wallets {
  const evm = useEvm();
  const solana = useSolana();
  const synthetic = solana.publicKey ? syntheticFor(solana.publicKey) : null;
  return {
    evm,
    solana,
    synthetic,
    anyConnected: Boolean(evm.address) || solana.connected,
    bothConnected: Boolean(evm.address) && solana.connected,
  };
}

export { useEvm } from "./evm";
export { useSolana } from "./solana";
