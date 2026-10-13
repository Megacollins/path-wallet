// The one-time "enable" step for Rome's wrapped tokens (see lib/rome.ts): each wallet grants a wrapper once, then the
// wrapper can move its tokens. This hook is what the Vault and Send pages call before the first move.
import { useCallback } from "react";
import type { Hex } from "viem";
import * as rome from "../../lib/rome";
import { useCfg } from "../network";
import { useWallets } from "../wallet";
import { useToast } from "../components/Toast";

export function useWrapperGrant() {
  const cfg = useCfg();
  const { evm } = useWallets();
  const toast = useToast();

  /**
   * MetaMask lane: resolves once `token` can move this wallet's tokens, sending the one-time grant (one extra wallet
   * confirmation, first time only) when it hasn't been sent. Throws a readable error for an old, unusable wrapper.
   * Note the grant needs the wallet's token account to exist, so call this AFTER the wallet holds some of the token
   * (in the Vault flow: after wrapping).
   */
  const ensureEvm = useCallback(
    async (token: Hex, symbol: string) => {
      const from = evm.address;
      const provider = evm.provider;
      if (!from || !provider) throw new Error("Connect MetaMask first.");
      const state = await rome.wrapperState(cfg, from, token);
      if (state === "legacy") throw new Error(rome.LEGACY_WRAPPER_MESSAGE);
      if (state === "needs_grant") {
        await toast.run(`Enable ${symbol} (one-time)`, () => rome.grantWrapper(provider, from, cfg, token, symbol), { success: `${symbol} enabled` });
      }
    },
    [cfg, evm.address, evm.provider, toast],
  );

  return { ensureEvm };
}
