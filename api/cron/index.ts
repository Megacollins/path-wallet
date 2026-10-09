// The scheduled indexer pass (every linked wallet + the Vault scan), and a status view.
//   GET|POST /api/cron/index            → run a pass
//   GET|POST /api/cron/index?status=1   → counts, cursors, freshness (no work done)
// Gated by CRON_SECRET: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own when that env var
// exists; anything else needs the same header. With no secret configured the endpoint is closed, never open.
import { timingSafeEqual } from "node:crypto";
import { fail, json } from "../_lib/auth.js";
import { query } from "../_lib/db.js";
import { runIndexer } from "../_lib/indexer/run.js";

function authorized(req: Request, secret: string): boolean {
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function status() {
  const [byKind, wallets, cursors, snaps, newest] = await Promise.all([
    query(`select source, kind, chain_id, status, count(*)::int as n from chain_events group by source, kind, chain_id, status order by source, kind, chain_id, status`),
    query(`select count(*)::int as n from wallets`),
    query(`select key, value, updated_at from indexer_state where key like 'vault:%' order by key`),
    query(`select count(*)::int as n from wallet_snapshots`),
    query(`select max(first_seen_at) as at from chain_events`),
  ]);
  return {
    wallets: wallets[0]?.n ?? 0,
    snapshots: snaps[0]?.n ?? 0,
    newestEventSeenAt: newest[0]?.at ? new Date(newest[0].at).toISOString() : null,
    events: byKind.map((r) => ({ source: r.source, kind: r.kind, chainId: Number(r.chain_id), status: r.status, count: Number(r.n) })),
    vaultCursors: cursors.map((c) => ({ key: c.key, ...c.value, updatedAt: new Date(c.updated_at).toISOString() })),
  };
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return fail(503, "cron_not_configured", "Set CRON_SECRET (16+ characters) to enable the scheduled indexer.");
  if (!authorized(req, secret)) return fail(401, "unauthorized", "Bad or missing bearer token.");
  if (new URL(req.url).searchParams.has("status")) return json(await status());
  return json(await runIndexer({ budgetMs: 50_000, force: true }));
}

export const GET = handle;
export const POST = handle;
