// Reads the unified portfolio for whichever lanes are connected, with manual
// refresh and light auto-refresh. One asset, both lanes — see lib/assets.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { readPortfolio, type Portfolio } from "../../lib/assets";
import { cfg } from "../config";
import { useWallets } from "../wallet";

export function usePortfolio(pollMs = 30_000) {
  const { evm, solana } = useWallets();
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const evmAddr = evm.address ?? undefined;
  const solPk = solana.publicKey ?? undefined;

  const refresh = useCallback(async () => {
    if (!evmAddr && !solPk) {
      setData(null);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const p = await readPortfolio(cfg, { evm: evmAddr, solana: solPk });
      setData(p);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [evmAddr, solPk]);

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
