// Bridge transfers, from Rome's bridge API: GET /v1/transfers?address=<addr> returns every transfer that
// address appears in (sender on any chain, or recipient), with its outcome as the transfer progresses.
// We keep one row per transfer and update its status in place, so "pending" becomes "complete" on a later sync.
import { query } from "../db.js";
import { getState, setState } from "./state.js";

const SYNC_EVERY_MS = 5 * 60_000;

const bridgeBase = () => (process.env.BRIDGE_API_URL?.trim() || "https://bridge-api.devnet.romeprotocol.xyz").replace(/\/+$/, "").replace(/\/v1$/, "");

const lower = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);

interface Transfer {
  id: string;
  route?: string;
  direction?: "to-rome" | "from-rome";
  amountIn?: string;
  outcome?: string;
  sender?: { ethereum?: string; solana?: string; rome?: string };
  steps?: { chainId?: string; rollupProgramId?: string }[];
  createdAt?: string;
  completedAt?: string | null;
  [k: string]: unknown;
}

/** The Rome chain a transfer settles on, when the record says so (0 = not stated; the raw record is kept either way). */
function romeChainOf(t: Transfer): number {
  const step = t.steps?.find((s) => s && s.rollupProgramId && s.chainId);
  const n = Number(step?.chainId);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const validDate = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

async function upsert(t: Transfer, fallbackActor: string): Promise<boolean> {
  if (!t || typeof t.id !== "string") return false;
  // The actor is whoever initiated it: the source-chain depositor (to-rome) or the Rome/Solana sender (from-rome).
  const actor = lower(t.sender?.ethereum) ?? (typeof t.sender?.solana === "string" ? t.sender.solana : null) ?? lower(t.sender?.rome) ?? fallbackActor;
  const route = String(t.route ?? "");
  const rows = await query(
    `insert into chain_events (source, kind, chain_id, address, amount, asset, external_id, status, occurred_at, completed_at, data)
     values ('bridge', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     on conflict (source, chain_id, external_id) do update
       set status = excluded.status, completed_at = excluded.completed_at, amount = excluded.amount, data = excluded.data, updated_at = now()
       where chain_events.status is distinct from excluded.status or chain_events.completed_at is distinct from excluded.completed_at
     returning id`,
    [
      t.direction === "from-rome" ? "bridge_out" : "bridge_in",
      romeChainOf(t),
      actor,
      /^\d+$/.test(String(t.amountIn ?? "")) ? String(t.amountIn) : null,
      route.includes("usdc") ? "usdc" : route || null,
      t.id,
      typeof t.outcome === "string" ? t.outcome : null,
      validDate(t.createdAt),
      validDate(t.completedAt),
      JSON.stringify(t),
    ],
  );
  return rows.length > 0;
}

export interface BridgeSyncResult {
  fetched: number;
  changed: number;
  skipped?: boolean;
}

export async function syncBridgeForAddress(address: string, opts: { force?: boolean } = {}): Promise<BridgeSyncResult> {
  const key = `bridge:${address}`;
  const last = await getState<{ at: number }>(key);
  if (!opts.force && last && Date.now() - last.at < SYNC_EVERY_MS) return { fetched: 0, changed: 0, skipped: true };

  const res = await fetch(`${bridgeBase()}/v1/transfers?address=${encodeURIComponent(address)}`, {
    headers: { accept: "application/json", "user-agent": "path-wallet-indexer/1" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`bridge-api ${res.status}`);
  const body = (await res.json()) as { transfers?: Transfer[] };
  const transfers = Array.isArray(body.transfers) ? body.transfers : [];
  let changed = 0;
  for (const t of transfers) if (await upsert(t, address)) changed++;
  await setState(key, { at: Date.now(), count: transfers.length });
  return { fetched: transfers.length, changed };
}
