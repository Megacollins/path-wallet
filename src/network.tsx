// Which Rome chain the app is pointed at. The registry publishes several (Hadrian, Martius, …);
// the user picks one and every page — portfolio, send, bridge, vault, settings — follows it.
// The choice is remembered per browser. Sits at the root so even the landing page can read it.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { defaultNetwork, networks } from "./config";
import type { PathConfig } from "../lib/assets";

const STORAGE_KEY = "path.network.v1";

function readStored(): PathConfig {
  try {
    const id = Number(localStorage.getItem(STORAGE_KEY));
    return networks.find((n) => n.chainId === id) ?? defaultNetwork;
  } catch {
    return defaultNetwork; // storage unavailable (private mode) — fall back to the default chain
  }
}

export interface NetworkState {
  /** The selected chain's full config. */
  cfg: PathConfig;
  /** Every selectable chain. */
  networks: PathConfig[];
  select: (chainId: number) => void;
}

const NetworkContext = createContext<NetworkState | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<PathConfig>(readStored);

  const select = useCallback((chainId: number) => {
    const next = networks.find((n) => n.chainId === chainId);
    if (!next) return;
    setCfg(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(chainId));
    } catch {
      /* the choice just won't survive a reload */
    }
  }, []);

  const value = useMemo<NetworkState>(() => ({ cfg, networks, select }), [cfg, select]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkState {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within NetworkProvider");
  return ctx;
}

/** The selected network's config — what every page and hook reads instead of a fixed chain. */
export function useCfg(): PathConfig {
  return useNetwork().cfg;
}
