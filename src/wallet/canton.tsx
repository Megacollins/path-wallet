// Canton lane (CIP-0103). Path is a *dApp* to the user's own Canton wallet: the wallet
// holds the keys and signs, we only ever see party ids and the ledger reads it proxies
// for us. The SDK (plus its wallet-picker UI and WalletConnect shims) is heavy, so it is
// loaded lazily — only when someone clicks Connect, or already had a saved session.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Sdk = typeof import("@canton-network/dapp-sdk");
let sdkPromise: Promise<Sdk> | null = null;
const loadSdk = () => (sdkPromise ??= import("@canton-network/dapp-sdk"));

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
        // defaultAdapters: [] — the SDK's built-in list is a single dev gateway on
        // http://localhost:3030, which it would probe on every init (and Chrome may prompt
        // for local-network access). Announced browser wallets are still discovered, and
        // the picker lets the user enter a gateway URL by hand.
        await sdk.init({ defaultAdapters: [] });
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
      await sdk.init({ defaultAdapters: [] });
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

  const primary = useMemo(() => accounts.find((a) => a.primary) ?? accounts[0] ?? null, [accounts]);

  const value = useMemo<CantonState>(
    () => ({ connected, connecting, accounts, primary, networkId, error, connect, disconnect, ledgerApi }),
    [connected, connecting, accounts, primary, networkId, error, connect, disconnect, ledgerApi],
  );

  return <CantonContext.Provider value={value}>{children}</CantonContext.Provider>;
}

export function useCanton(): CantonState {
  const ctx = useContext(CantonContext);
  if (!ctx) throw new Error("useCanton must be used within CantonProvider");
  return ctx;
}
