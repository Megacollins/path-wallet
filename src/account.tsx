// The Path account: one identity across both lanes. Signing in proves you own a wallet (a free
// signature — no transaction, no gas); linking adds your other lane's wallet to the same account.
// Everything here is optional: the wallet works fully without an account, and if the API isn't
// reachable the account UI simply doesn't appear.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { stringToHex } from "viem";
import { useWallets } from "./wallet";

export type Kind = "evm" | "solana";
export interface AccountWallet {
  kind: Kind;
  address: string;
  syntheticAddress: string | null;
  linkedAt: string;
}
export interface Account {
  id: string;
  createdAt: string;
  wallets: AccountWallet[];
}
type Status = "loading" | "anon" | "authed" | "unavailable";

interface AccountState {
  status: Status;
  account: Account | null;
  busy: boolean;
  error: string | null;
  signIn: (kind: Kind) => Promise<void>;
  link: (kind: Kind) => Promise<void>;
  unlink: (w: Pick<AccountWallet, "kind" | "address">) => Promise<void>;
  signOut: () => Promise<void>;
  /** Does this connected wallet already belong to the signed-in account? */
  isLinked: (kind: Kind, address: string | null | undefined) => boolean;
}

const Ctx = createContext<AccountState | null>(null);

class ApiError extends Error {}

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // No API behind this origin (e.g. a static host) answers with the app's HTML, not JSON.
  if (!(res.headers.get("content-type") ?? "").includes("json")) throw new ApiError("unavailable");
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const rejected = (e: any) => e?.code === 4001 || e?.code === "ACTION_REJECTED" || /reject|denied|declin|cancel/i.test(e?.message ?? "");
const norm = (kind: Kind, a: string) => (kind === "evm" ? a.toLowerCase() : a);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { evm, solana } = useWallets();
  const [status, setStatus] = useState<Status>("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ account: Account | null }>("/api/me")
      .then((r) => {
        if (!alive) return;
        setAccount(r.account);
        setStatus(r.account ? "authed" : "anon");
      })
      .catch(() => alive && setStatus("unavailable"));
    return () => {
      alive = false;
    };
  }, []);

  // The connected wallet's address for a lane, and a function that signs a message with it.
  const lane = useCallback(
    (kind: Kind): { address: string; sign: (message: string) => Promise<string> } => {
      if (kind === "evm") {
        const { address, provider } = evm;
        if (!address || !provider) throw new Error("Connect MetaMask first.");
        return { address, sign: async (m) => (await provider.request({ method: "personal_sign", params: [stringToHex(m), address] })) as string };
      }
      const { publicKey, signMessage } = solana;
      if (!publicKey || !signMessage) throw new Error("Connect Phantom first (and use a wallet that can sign messages).");
      return { address: publicKey.toBase58(), sign: async (m) => btoa(String.fromCharCode(...(await signMessage(new TextEncoder().encode(m))))) };
    },
    [evm, solana],
  );

  const run = useCallback(
    async (kind: Kind, purpose: "signin" | "link") => {
      setBusy(true);
      setError(null);
      try {
        const { address, sign } = lane(kind);
        const ch = await api<{ nonce: string; message: string }>("/api/auth/challenge", { kind, address, purpose });
        const signature = await sign(ch.message);
        const r = await api<{ account: Account }>("/api/auth/verify", { nonce: ch.nonce, signature });
        setAccount(r.account);
        setStatus("authed");
      } catch (e: any) {
        if (rejected(e)) setError("You cancelled the signature.");
        else if (e instanceof ApiError) setStatus("unavailable");
        else setError(e?.message ?? "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [lane],
  );

  const unlink = useCallback(async (w: Pick<AccountWallet, "kind" | "address">) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ account: Account }>("/api/wallets/unlink", w);
      setAccount(r.account);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't unlink that wallet.");
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", {});
    } catch {
      /* the session may already be gone; either way we are signed out locally */
    }
    setAccount(null);
    setStatus("anon");
    setError(null);
    setBusy(false);
  }, []);

  const value = useMemo<AccountState>(
    () => ({
      status,
      account,
      busy,
      error,
      signIn: (kind) => run(kind, "signin"),
      link: (kind) => run(kind, "link"),
      unlink,
      signOut,
      isLinked: (kind, address) => Boolean(address && account?.wallets.some((w) => w.kind === kind && w.address === norm(kind, address))),
    }),
    [status, account, busy, error, run, unlink, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
