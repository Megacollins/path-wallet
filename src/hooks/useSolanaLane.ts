// Phantom lane actions (lib/romeLane.ts) wired to the connected wallet: finds the wallet's Wallet Standard signer, runs the
// planned steps, and narrates them ("Step 2 of 5: …") through the toast the caller passes as `note`.
import { useCallback, useMemo } from "react";
import type { Hex } from "viem";
import { browserGuard } from "../../lib/laneGuard";
import { solanaDepositFlow, solanaSendFlow, solanaWithdrawFlow, type LaneEnv, type Progress } from "../../lib/romeLane";
import { useCfg } from "../network";
import { useWallets } from "../wallet";
import { laneSignerFor } from "../wallet/laneSigner";

// One guard for the whole page: it remembers unconfirmed transactions across reloads and tabs, and locks a wallet while an action runs.
const guard = browserGuard();

export function useSolanaLane() {
  const cfg = useCfg();
  const { solana } = useWallets();

  const env = useCallback(async (): Promise<LaneEnv> => {
    const wallet = solana.publicKey;
    if (!wallet || !solana.signTransaction) throw new Error("Connect Phantom first.");
    const found = await laneSignerFor(wallet, { connect: true });
    if (!found) throw new Error("Couldn't reach your wallet's signing features. Reconnect Phantom and try again (see /lane-check).");
    return { cfg, wallet, signer: found.signer, signTransaction: solana.signTransaction, guard };
  }, [cfg, solana.publicKey, solana.signTransaction]);

  const narrate = (note: (text: string) => void): Progress => (i, total, step) => note(`Step ${i + 1} of ${total}: ${step.label}. Approve in Phantom…`);

  return useMemo(
    () => ({
      deposit: async (vault: Hex, amount: bigint, note: (text: string) => void) => void (await solanaDepositFlow(await env(), vault, amount, narrate(note))),
      withdraw: async (vault: Hex, amount: bigint, note: (text: string) => void) => void (await solanaWithdrawFlow(await env(), vault, amount, narrate(note))),
      send: async (to: Hex, amount: bigint, note: (text: string) => void) => void (await solanaSendFlow(await env(), to, amount, narrate(note))),
    }),
    [env],
  );
}
