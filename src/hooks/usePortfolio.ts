// Reads the unified portfolio for whichever lanes are connected, with manual
// refresh and light auto-refresh. One asset, both lanes — see lib/assets.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { readPortfolio, type Portfolio } from "../../lib/assets";
import { useCfg } from "../network";
import { useWallets } from "../wallet";

export function usePortfolio(pollMs = 30_000) {
  const cfg = useCfg();
  const { evm, solana } = useWallets();
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which chain a fetch is for. A fetch still running for the PREVIOUS network must neither block
  // the new network's fetch nor write its (stale) numbers into the page after a switch.
  const inFlight = useRef<number | null>(null);
  const activeChain = useRef(cfg.chainId);
  activeChain.current = cfg.chainId;

  const evmAddr = evm.address ?? undefined;
  const solPk = solana.publicKey ?? undefined;

  const refresh = useCallback(async () => {
    if (!evmAddr && !solPk) {
      setData(null);
      return;
    }
    const chain = cfg.chainId;
    if (inFlight.current === chain) return;
    inFlight.current = chain;
    setLoading(true);
    setError(null);
    try {
      const p = await readPortfolio(cfg, { evm: evmAddr, solana: solPk });
      if (activeChain.current === chain) setData(p);
    } catch (e: any) {
      if (activeChain.current === chain) setError(e?.message ?? String(e));
    } finally {
      if (inFlight.current === chain) inFlight.current = null;
      if (activeChain.current === chain) setLoading(false);
    }
  }, [evmAddr, solPk, cfg]);

  // Don't show the previous network's balances while the new network loads.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [cfg.chainId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!evmAddr && !solPk) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, evmAddr, solPk, pollMs]);

  return { data, loading, error, refresh };
}
