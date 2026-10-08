// Canton lane (CIP-0103). Path is a *dApp* to the user's own Canton wallet: the wallet
// holds the keys and signs, we only ever see party ids and the ledger reads it proxies
// for us. The SDK (plus its wallet-picker UI and WalletConnect shims) is heavy, so it is
// loaded lazily — only when someone clicks Connect, or already had a saved session.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Sdk = typeof import("@canton-network/dapp-sdk");
let sdkPromise: Promise<Sdk> | null = null;
const loadSdk = () => (sdkPromise ??= import("@canton-network/dapp-sdk"));

// Which wallets the picker can offer, beyond whatever announces itself in the browser:
//  - Console Wallet's Chrome extension, registered explicitly so it is probed even when it
//    doesn't announce (the id comes from its Chrome Web Store listing). Only wallets that
//    actually answer the handshake make it into the picker, so nothing phantom is listed.
//  - WalletConnect (mobile / cross-device wallets), only when a project id is configured.
//  - Remote wallet gateways: the picker lets the user type a gateway URL.
const CONSOLE_WALLET_EXTENSION_ID = "lpnfhpbpmlobjlgkdmnjieeihjmihhjd";
const WC_PROJECT_ID = (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)?.trim() || "";

async function initSdk(sdk: Sdk) {
  const additionalAdapters = [
    new sdk.ExtensionAdapter({
      providerId: `browser:ext:${CONSOLE_WALLET_EXTENSION_ID}` as never,
      name: "Console Wallet",
      description: "Connect via the Console Wallet browser extension",
      target: CONSOLE_WALLET_EXTENSION_ID,
    }),
  ];
  if (WC_PROJECT_ID) {
    try {
      additionalAdapters.push(
        sdk.WalletConnectAdapter.create({
          projectId: WC_PROJECT_ID,
          metadata: { name: "Path", description: "Dual-lane smart wallet on Rome", url: window.location.origin, icons: [`${window.location.origin}/favicon.svg`] },
        }) as never,
      );
    } catch {
      /* a bad WalletConnect config must never stop extension / gateway wallets from connecting */
    }
  }
  // defaultAdapters: [] — the SDK's built-in list is a single dev gateway on
  // http://localhost:3030, which it would probe on every init (and Chrome may prompt for
  // local-network access). enableSuggestedWallets: false — its only suggestion is an
  // *install link* for "Send Connect", which reads as a wallet that then "refuses to connect".
  await sdk.init({ defaultAdapters: [], additionalAdapters, enableSuggestedWallets: false });
}

export interface AnnouncedWallet {
  id: string;
  name: string;
}
export interface WalletScan {
  /** Browser wallets that answered `canton:requestProvider` with `canton:announceProvider`. */
  announced: AnnouncedWallet[];
  /** A legacy `window.canton` provider is present. */
  injected: boolean;
}

/** Ask the page which Canton wallets are present (the same announce handshake the SDK uses). */
function scanWallets(timeoutMs = 600): Promise<WalletScan> {
  return new Promise((resolve) => {
    const found = new Map<string, AnnouncedWallet>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; name?: string }>).detail;
      if (d?.id && d?.name) found.set(d.id, { id: d.id, name: d.name });
    };
    window.addEventListener("canton:announceProvider", onAnnounce);
    window.dispatchEvent(new CustomEvent("canton:requestProvider", { detail: {} }));
    setTimeout(() => {
      window.removeEventListener("canton:announceProvider", onAnnounce);
      resolve({ announced: [...found.values()], injected: Boolean((window as unknown as { canton?: unknown }).canton) });
    }, timeoutMs);
  });
}

/** A Canton "wallet" as the dApp API reports it: one party the user authorised us to see. */
export interface CantonAccount {
  partyId: string;
  hint: string;
  networkId: string;
  primary: boolean;
}

/** A proxied Canton JSON Ledger API call (made through the wallet, with the wallet's auth). */
export type CantonLedgerRequest = Parameters<Sdk["ledgerApi"]>[0];

export interface CantonState {
  connected: boolean;
  connecting: boolean;
  accounts: CantonAccount[];
  /** The party Path acts for: the wallet's primary account, else the first one. */
  primary: CantonAccount | null;
  networkId: string | null;
  error: string | null;
  /** What the last wallet scan found in this browser (null until a scan has run). */
  detected: WalletScan | null;
  /** Whether WalletConnect (mobile / cross-device wallets) is configured for this build. */
  walletConnect: boolean;
  scan: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  ledgerApi: (req: CantonLedgerRequest) => Promise<unknown>;
}

/** `name::1220ab…cdef` — a party id is `hint::<68-hex fingerprint>`, far too long to show whole. */
export function shortParty(partyId: string): string {
  const [name, fp] = partyId.split("::");
  return fp && fp.length > 14 ? `${name}::${fp.slice(0, 6)}…${fp.slice(-4)}` : partyId;
}

const SESSION_FLAG = "path.canton.session.v1";
const flag = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_FLAG) === "1";
    } catch {
      return false;
    }
  },
  set: () => {
    try {
      localStorage.setItem(SESSION_FLAG, "1");
    } catch {
      /* private mode — the session just won't auto-restore */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(SESSION_FLAG);
    } catch {
      /* ignore */
    }
  },
};

const CantonContext = createContext<CantonState | null>(null);

/** The user closing the wallet picker / rejecting the prompt is a choice, not a failure. */
function isUserCancel(e: unknown): boolean {
  const x = e as { name?: string; message?: string };
  return x?.name === "UserRejectedError" || /reject|cancel|closed|dismiss/i.test(x?.message ?? "");
}

function errMessage(e: unknown): string {
  const x = e as { message?: string; error?: { message?: string } };
  const msg = x?.message || x?.error?.message || String(e);
  // The SDK's wallet picker is a pop-up window; when the browser blocks it the raw message
  // ("Failed to open popup window") means nothing to a user.
  return /popup/i.test(msg) ? "Your browser blocked the Canton wallet window — allow pop-ups for this site, then try again." : msg;
}

export function CantonProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<CantonAccount[]>([]);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscribed = useRef(false);

  const reset = useCallback(() => {
    setConnected(false);
    setAccounts([]);
    setNetworkId(null);
  }, []);

  const refresh = useCallback(async () => {
    const sdk = await loadSdk();
    const [list, st] = await Promise.all([sdk.listAccounts(), sdk.status()]);
    const accts: CantonAccount[] = list.map((w) => ({ partyId: w.partyId, hint: w.hint, networkId: w.networkId, primary: Boolean(w.primary) }));
    setAccounts(accts);
    setNetworkId(st.network?.networkId ?? accts[0]?.networkId ?? null);
    setConnected(Boolean(st.connection.isConnected));
  }, []);

  // Keep in step with the wallet (user switches account / disconnects inside the wallet).
  const subscribe = useCallback(
    async (sdk: Sdk) => {
      if (subscribed.current) return;
      subscribed.current = true;
      await sdk.onAccountsChanged(() => void refresh().catch(() => {}));
      await sdk.onStatusChanged((s) => {
        if (!s.connection.isConnected) {
          flag.clear();
          reset();
        } else void refresh().catch(() => {});
      });
    },
    [refresh, reset],
  );

  // Restore a previous session — but only load the SDK at all if there was one.
  useEffect(() => {
    if (!flag.get()) return;
    let cancelled = false;
    (async () => {
      try {
        const sdk = await loadSdk();
        await initSdk(sdk);
        const c = await sdk.isConnected();
        if (cancelled) return;
        if (c.isConnected) {
          await refresh();
          await subscribe(sdk);
        } else flag.clear();
      } catch {
        flag.clear();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, subscribe]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const sdk = await loadSdk();
      await initSdk(sdk);
      await sdk.connect(); // opens the SDK's wallet picker and runs the wallet's own auth flow
      await refresh();
      await subscribe(sdk);
      flag.set();
    } catch (e) {
      if (!isUserCancel(e)) setError(errMessage(e));
    } finally {
      setConnecting(false);
    }
  }, [refresh, subscribe]);

  const disconnect = useCallback(async () => {
    try {
      const sdk = await loadSdk();
      await sdk.disconnect();
    } catch {
      /* already gone */
    }
    flag.clear();
    reset();
  }, [reset]);

  const ledgerApi = useCallback(async (req: CantonLedgerRequest) => {
    const sdk = await loadSdk();
    return sdk.ledgerApi(req);
  }, []);

  const [detected, setDetected] = useState<WalletScan | null>(null);
  const scan = useCallback(async () => setDetected(await scanWallets()), []);

  const primary = useMemo(() => accounts.find((a) => a.primary) ?? accounts[0] ?? null, [accounts]);

  const value = useMemo<CantonState>(
    () => ({ connected, connecting, accounts, primary, networkId, error, detected, walletConnect: Boolean(WC_PROJECT_ID), scan, connect, disconnect, ledgerApi }),
    [connected, connecting, accounts, primary, networkId, error, detected, scan, connect, disconnect, ledgerApi],
  );

  return <CantonContext.Provider value={value}>{children}</CantonContext.Provider>;
}

export function useCanton(): CantonState {
  const ctx = useContext(CantonContext);
  if (!ctx) throw new Error("useCanton must be used within CantonProvider");
  return ctx;
}
