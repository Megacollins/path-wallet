// One provider tree, every lane. `useWallets()` is the single hook the app uses:
// MetaMask (EVM) and Phantom (Solana) connected *simultaneously*, plus the
// derived synthetic address that is the Phantom user's EVM identity on Rome, plus the
// optional Canton lane (the user's own Canton wallet, via CIP-0103).
import { type ReactNode } from "react";
import type { Hex } from "viem";
import { EvmProvider, useEvm, type EvmState } from "./evm";
import { SolanaWalletProvider, useSolana, type SolanaState } from "./solana";
import { CantonProvider, useCanton, type CantonState } from "./canton";
import { syntheticFor } from "../../lib/rome";

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <EvmProvider>
      <SolanaWalletProvider>
        <CantonProvider>{children}</CantonProvider>
      </SolanaWalletProvider>
    </EvmProvider>
  );
}

export interface Wallets {
  evm: EvmState;
  solana: SolanaState;
  /**
   * Canton is a separate ledger, not part of Rome's shared EVM/Solana state — so it is
   * deliberately NOT counted in `anyConnected` / `bothConnected` (those gate flows that
   * need a Rome lane). Check `canton.connected` for it.
   */
  canton: CantonState;
  /** The Phantom user's EVM identity on Rome (keccak256(pubkey)[12:]). */
  synthetic: Hex | null;
  anyConnected: boolean;
  bothConnected: boolean;
}

export function useWallets(): Wallets {
  const evm = useEvm();
  const solana = useSolana();
  const canton = useCanton();
  const synthetic = solana.publicKey ? syntheticFor(solana.publicKey) : null;
  return {
    evm,
    solana,
    canton,
    synthetic,
    anyConnected: Boolean(evm.address) || solana.connected,
    bothConnected: Boolean(evm.address) && solana.connected,
  };
}

export { useEvm } from "./evm";
export { useSolana } from "./solana";
export { useCanton } from "./canton";
