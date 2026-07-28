// EVM lane (MetaMask). We discover the injected provider via EIP-6963 so we bind
// to MetaMask *specifically* — Phantom also injects an EVM provider on
// window.ethereum, and the two must coexist. Every write still goes through the
// Rome SDK's submitRomeTx (see lib/rome.ts); this context only owns connection,
// the account, and keeping the wallet on the Rome network.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { cfg } from "../config";

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

export interface EvmState {
  available: boolean;
  address: Hex | null;
  chainId: number | null;
  isRome: boolean;
  connecting: boolean;
  provider: Eip1193Provider | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToRome: () => Promise<void>;
}

const EvmContext = createContext<EvmState | null>(null);

function hexChain(id: number): string {
  return `0x${id.toString(16)}`;
}

function romeChainParams() {
  return {
    chainId: hexChain(cfg.chainId),
    chainName: cfg.chainName,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: [cfg.proxyUrl],
    blockExplorerUrls: cfg.explorerUrl ? [cfg.explorerUrl] : [],
  };
}

export function EvmProvider({ children }: { children: ReactNode }) {
  const providersRef = useRef<Map<string, Eip6963Detail>>(new Map());
  const [available, setAvailable] = useState(false);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [address, setAddress] = useState<Hex | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Collect EIP-6963 announcements.
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Eip6963Detail>).detail;
      if (detail?.info?.rdns) {
        providersRef.current.set(detail.info.rdns, detail);
        setAvailable(true);
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Legacy fallback: a lone window.ethereum with no 6963 support.
    if ((window as any).ethereum) setAvailable(true);
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  }, []);

  const pickProvider = useCallback((): Eip1193Provider | null => {
    const map = providersRef.current;
    const metamask = map.get("io.metamask");
    if (metamask) return metamask.provider;
    // Prefer any announced non-Phantom EVM provider, else legacy window.ethereum.
    for (const [rdns, d] of map) if (rdns !== "app.phantom") return d.provider;
    return ((window as any).ethereum as Eip1193Provider) ?? null;
  }, []);

  const bindEvents = useCallback((p: Eip1193Provider) => {
    p.on?.("accountsChanged", (accts: string[]) => setAddress((accts[0] as Hex) ?? null));
    p.on?.("chainChanged", (cid: string) => setChainId(parseInt(cid, 16)));
  }, []);

  const switchToRome = useCallback(async () => {
    const p = provider ?? pickProvider();
    if (!p) throw new Error("No EVM wallet found");
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain(cfg.chainId) }] });
    } catch (err: any) {
      // 4902 = chain unknown to the wallet → add it, then it's selected.
      if (err?.code === 4902 || /unrecognized|not been added/i.test(err?.message ?? "")) {
        await p.request({ method: "wallet_addEthereumChain", params: [romeChainParams()] });
      } else {
        throw err;
      }
    }
    setChainId(cfg.chainId);
  }, [provider, pickProvider]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const p = pickProvider();
      if (!p) throw new Error("No EVM wallet detected. Install MetaMask to use the EVM lane.");
      setProvider(p);
      bindEvents(p);
      const accts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress((accts[0] as Hex) ?? null);
      const cid = (await p.request({ method: "eth_chainId" })) as string;
      setChainId(parseInt(cid, 16));
      if (parseInt(cid, 16) !== cfg.chainId) await switchToRome();
    } finally {
      setConnecting(false);
    }
  }, [pickProvider, bindEvents, switchToRome]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setProvider(null);
  }, []);

  const value = useMemo<EvmState>(
    () => ({
      available,
      address,
      chainId,
      isRome: chainId === cfg.chainId,
      connecting,
      provider,
      connect,
      disconnect,
      switchToRome,
    }),
    [available, address, chainId, connecting, provider, connect, disconnect, switchToRome],
  );

  return <EvmContext.Provider value={value}>{children}</EvmContext.Provider>;
}

export function useEvm(): EvmState {
  const ctx = useContext(EvmContext);
  if (!ctx) throw new Error("useEvm must be used within EvmProvider");
  return ctx;
}
