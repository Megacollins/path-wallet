// The connected Canton party's token-standard (CIP-0056) holdings, read through the user's
// own Canton wallet. Phase 1 of the Canton lane: read-only.
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { shortParty, useCanton } from "../wallet/canton";
import { useCantonHoldings } from "../hooks/useCantonHoldings";
import { Card, Copyable, Eyebrow, Skeleton } from "./ui";

/** "1234567.5" → "1,234,567.5" without going through a float. */
function group(decimal: string): string {
  const [int, frac] = decimal.split(".");
  const neg = int.startsWith("-");
  const g = BigInt(neg ? int.slice(1) : int).toLocaleString();
  return `${neg ? "-" : ""}${g}${frac ? "." + frac : ""}`;
}

export function CantonHoldings() {
  const { primary, networkId } = useCanton();
  const { balances, loading, error, details, refresh } = useCantonHoldings();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <Card className="hover-glow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Canton</Eyebrow>
          <h2 className="mt-1 font-serif text-xl text-parchment">Holdings</h2>
        </div>
        <div className="flex items-center gap-2">
          {networkId && <span className="chip max-w-[12rem] truncate !py-0.5 !text-[10px]">{networkId}</span>}
          <button onClick={() => void refresh()} disabled={loading || !primary} className="btn-ghost !px-3 !py-2 text-xs" aria-label="Refresh Canton holdings">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {primary ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-parchment/40">
          <span>party</span>
          <Copyable text={primary.partyId} display={shortParty(primary.partyId)} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-parchment/60">
          Your Canton wallet is connected, but it hasn't shared any account (party) with Path. Allow one in the wallet, then refresh.
        </p>
      )}

      {primary && (
        <div className="mt-4">
          {loading && !balances ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-terracotta-500/40 bg-terracotta-500/10 p-3 text-sm text-terracotta-300" role="alert">
              <p className="font-medium">Couldn't read your Canton holdings.</p>
              <p className="mt-1 break-words text-terracotta-300/90">{error}</p>
            </div>
          ) : balances && balances.length === 0 ? (
            <p className="text-sm text-parchment/55">
              No token-standard (CIP-0056) holdings found for this party{networkId ? ` on ${networkId}` : ""}. Tokens that don't implement that standard aren't shown yet.
            </p>
          ) : (
            <ul className="divide-y divide-gold/10">
              {(balances ?? []).map((b) => (
                <li key={`${b.admin}|${b.id}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-serif text-lg text-parchment">{b.id}</div>
                    <div className="truncate text-[11px] text-parchment/40" title={b.admin}>
                      issuer {shortParty(b.admin)} · {b.holdings} holding{b.holdings === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular text-parchment">{group(b.total)}</div>
                    {b.locked !== "0" && <div className="tabular text-[11px] text-parchment/45">{group(b.locked)} locked</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {Array.isArray(details) && details.length > 0 && (
            <div className="mt-3">
              <button onClick={() => setShowDetails((v) => !v)} className="text-[11px] text-parchment/40 underline decoration-parchment/20 underline-offset-4 hover:text-parchment/70" aria-expanded={showDetails}>
                {showDetails ? "Hide" : "Show"} request details
              </button>
              {showDetails && (
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-gold/15 bg-stone-950/60 p-3 text-[11px] text-parchment/70">{JSON.stringify(details, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
