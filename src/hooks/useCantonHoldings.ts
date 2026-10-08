// Reads the connected party's token-standard (CIP-0056) holdings through the user's Canton
// wallet — the wallet proxies the call to the participant's JSON Ledger API with its own
// auth, Path never sees a token. Holdings are the `Holding` interface contracts; amounts
// are summed per instrument (issuer + id), locked amounts kept separate.
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanton } from "../wallet/canton";

/** Package-name reference to the token standard's Holding interface (resolved by the participant). */
const HOLDING_INTERFACE = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";

export interface CantonInstrumentBalance {
  /** Instrument id, e.g. "Amulet". */
  id: string;
  /** The issuer (instrument admin) party. */
  admin: string;
  /** Total held, decimal string. */
  total: string;
  /** Of which locked (e.g. mid-transfer / allocated), decimal string. */
  locked: string;
  /** Number of holding contracts. */
  holdings: number;
}

export interface CantonHoldingsState {
  balances: CantonInstrumentBalance[] | null;
  loading: boolean;
  error: string | null;
  /** What each ledger request returned/failed with — shown on demand so a failure can be diagnosed. */
  details: unknown;
  refresh: () => Promise<void>;
}

// Canton decimals have 10 places; sum as scaled integers so totals never show float noise.
const SCALE = 10;
const toUnits = (s: string): bigint => {
  const neg = s.startsWith("-");
  const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
  const n = BigInt((i || "0") + f.padEnd(SCALE, "0").slice(0, SCALE));
  return neg ? -n : n;
};
const fromUnits = (u: bigint): string => {
  const neg = u < 0n;
  const s = (neg ? -u : u).toString().padStart(SCALE + 1, "0");
  const frac = s.slice(-SCALE).replace(/0+$/, "");
  return `${neg ? "-" : ""}${s.slice(0, -SCALE)}${frac ? "." + frac : ""}`;
};

interface RawHolding {
  admin: string;
  id: string;
  amount: string;
  locked: boolean;
}

/** Pull Holding views out of an active-contracts response, tolerating the shapes the JSON API / proxies use. */
function extractHoldings(resp: unknown): { holdings: RawHolding[]; entries: number; withViews: number } {
  const r = resp as Record<string, unknown> | unknown[] | null | undefined;
  const list: unknown[] = Array.isArray(r) ? r : ((r?.items ?? r?.result ?? r?.activeContracts ?? r?.contracts ?? []) as unknown[]);
  const holdings: RawHolding[] = [];
  let withViews = 0;
  for (const entry of Array.isArray(list) ? list : []) {
    const e = entry as any;
    const created = e?.contractEntry?.JsActiveContract?.createdEvent ?? e?.JsActiveContract?.createdEvent ?? e?.createdEvent ?? e;
    const views: any[] = created?.interfaceViews ?? [];
    if (views.length) withViews++;
    const view = (views.find((v) => /Holding/.test(v?.interfaceId ?? "")) ?? views[0])?.viewValue;
    if (view && view.amount !== undefined && view.instrumentId) {
      holdings.push({ admin: String(view.instrumentId.admin ?? ""), id: String(view.instrumentId.id ?? ""), amount: String(view.amount), locked: view.lock != null });
    }
  }
  return { holdings, entries: Array.isArray(list) ? list.length : 0, withViews };
}

export function useCantonHoldings(): CantonHoldingsState {
  const { connected, primary, ledgerApi } = useCanton();
  const [balances, setBalances] = useState<CantonInstrumentBalance[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(null);
  const inFlight = useRef(false);
  const party = primary?.partyId;

  const refresh = useCallback(async () => {
    if (!connected || !party || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    const attempts: Record<string, unknown>[] = [];
    try {
      // The active-contracts snapshot must name an offset: take the current ledger end.
      const end = (await ledgerApi({ requestMethod: "get", resource: "/v2/state/ledger-end" })) as any;
      const offset = end?.offset ?? end?.result?.offset;
      attempts.push({ step: "ledger-end", response: end });
      if (offset === undefined) throw new Error("The wallet's ledger didn't report a ledger-end offset.");

      const filter = { filtersByParty: { [party]: { cumulative: [{ identifierFilter: { InterfaceFilter: { value: { interfaceId: HOLDING_INTERFACE, includeInterfaceView: true, includeCreatedEventBlob: false } } } }] } } };
      // Canton ≥ 3.3 asks for `eventFormat`; older participants take `filter` + `verbose`. Try the new shape, then the old.
      const bodies: [string, Record<string, unknown>][] = [
        ["eventFormat", { eventFormat: { ...filter, verbose: false }, activeAtOffset: offset }],
        ["filter", { filter, verbose: false, activeAtOffset: offset }],
      ];
      let parsed: ReturnType<typeof extractHoldings> | null = null;
      let lastErr: unknown = null;
      for (const [form, body] of bodies) {
        try {
          const resp = await ledgerApi({ requestMethod: "post", resource: "/v2/state/active-contracts", body });
          const p = extractHoldings(resp);
          attempts.push({ step: `active-contracts (${form})`, entries: p.entries, entriesWithHoldingView: p.withViews, holdings: p.holdings.length });
          parsed = p;
          break;
        } catch (e) {
          lastErr = e;
          attempts.push({ step: `active-contracts (${form})`, error: (e as any)?.message ?? e });
        }
      }
      if (!parsed) throw lastErr ?? new Error("The holdings request failed.");

      const byInstrument = new Map<string, { id: string; admin: string; total: bigint; locked: bigint; n: number }>();
      for (const h of parsed.holdings) {
        const key = `${h.admin}|${h.id}`;
        const row = byInstrument.get(key) ?? { id: h.id, admin: h.admin, total: 0n, locked: 0n, n: 0 };
        const u = toUnits(h.amount);
        row.total += u;
        if (h.locked) row.locked += u;
        row.n++;
        byInstrument.set(key, row);
      }
      setBalances([...byInstrument.values()].map((r) => ({ id: r.id, admin: r.admin, total: fromUnits(r.total), locked: fromUnits(r.locked), holdings: r.n })));
    } catch (e: any) {
      setBalances(null);
      setError(e?.message || e?.error?.message || String(e));
    } finally {
      setDetails(attempts);
      setLoading(false);
      inFlight.current = false;
    }
  }, [connected, party, ledgerApi]);

  useEffect(() => {
    if (!connected || !party) {
      setBalances(null);
      setError(null);
      setDetails(null);
      return;
    }
    void refresh();
  }, [connected, party, refresh]);

  return { balances, loading, error, details, refresh };
}
