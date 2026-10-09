// Settings card for the Path account: sign in with a connected wallet, link the other lane's
// wallet to the same account, unlink, sign out. Hidden entirely when the API isn't reachable.
import { shorten } from "../../lib/format";
import { useAccount, type Kind } from "../account";
import { useWallets } from "../wallet";
import { Button, Card, Skeleton } from "./ui";

const LANE: Record<Kind, { glyph: string; name: string }> = {
  evm: { glyph: "🦊", name: "MetaMask" },
  solana: { glyph: "👻", name: "Phantom" },
};

export function AccountCard() {
  const { status, account, busy, error, signIn, link, unlink, signOut, isLinked } = useAccount();
  const { evm, solana } = useWallets();

  if (status === "unavailable") return null;

  const connected: { kind: Kind; address: string }[] = [
    ...(evm.address ? [{ kind: "evm" as const, address: evm.address }] : []),
    ...(solana.connected && solana.publicKey ? [{ kind: "solana" as const, address: solana.publicKey.toBase58() }] : []),
  ];
  const linkable = connected.filter((c) => !isLinked(c.kind, c.address));

  return (
    <Card>
      <h2 className="font-serif text-xl text-parchment">Path account</h2>
      <p className="mt-1 text-sm text-parchment/55">
        One identity across both lanes. Signing in is a free signature: no transaction, no gas, and Path never sees your keys.
      </p>

      {status === "loading" && <Skeleton className="mt-4 h-10 w-full" />}

      {status === "anon" && (
        <div className="mt-4 space-y-3">
          {connected.length === 0 ? (
            <p className="text-sm text-parchment/50">Connect a wallet above, then sign in with it.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connected.map((c) => (
                <Button key={c.kind} onClick={() => signIn(c.kind)} loading={busy}>
                  {LANE[c.kind].glyph} Sign in with {LANE[c.kind].name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {status === "authed" && account && (
        <div className="mt-4 space-y-4">
          <ul className="divide-y divide-gold/8">
            {account.wallets.map((w) => {
              const live = connected.some((c) => c.kind === w.kind && isLinked(c.kind, c.address) && c.address.toLowerCase() === w.address.toLowerCase());
              return (
                <li key={`${w.kind}:${w.address}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/25 bg-stone-800">{LANE[w.kind].glyph}</span>
                    <div className="min-w-0">
                      <div className="text-sm text-parchment">
                        {LANE[w.kind].name} {live && <span className="ml-1 text-[11px] text-emerald-300">connected</span>}
                      </div>
                      <div className="tabular truncate font-mono text-xs text-parchment/50">{shorten(w.address, 6, 4)}</div>
                    </div>
                  </div>
                  {account.wallets.length > 1 && (
                    <button onClick={() => unlink(w)} disabled={busy} className="py-1.5 text-[11px] text-parchment/40 underline hover:text-parchment/70 disabled:opacity-40">
                      unlink
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {linkable.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {linkable.map((c) => (
                <Button key={c.kind} variant="ghost" onClick={() => link(c.kind)} loading={busy}>
                  Link {LANE[c.kind].name} to this account
                </Button>
              ))}
            </div>
          )}

          <button onClick={signOut} disabled={busy} className="py-1.5 text-xs text-parchment/45 underline hover:text-parchment/70 disabled:opacity-40">
            Sign out
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-terracotta-300">{error}</p>}
    </Card>
  );
}
