// The scheduled indexer pass (every linked wallet + the Vault scan), and a status view.
//   GET|POST /api/cron/index            → run a pass
//   GET|POST /api/cron/index?status=1   → counts, cursors, freshness (no work done)
//   GET|POST /api/cron/index?points=1   → points totals and the top accounts (owner-only; no work done)
// Gated by CRON_SECRET: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own when that env var
// exists; anything else needs the same header. With no secret configured the endpoint is closed, never open.
import { timingSafeEqual } from "node:crypto";
import { fail, json } from "../_lib/auth.js";
import { indexerStatus as status, leaderboard } from "../_lib/admin.js";
import { runIndexer } from "../_lib/indexer/run.js";

function authorized(req: Request, secret: string): boolean {
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return fail(503, "cron_not_configured", "Set CRON_SECRET (16+ characters) to enable the scheduled indexer.");
  if (!authorized(req, secret)) return fail(401, "unauthorized", "Bad or missing bearer token.");
  if (new URL(req.url).searchParams.has("status")) return json(await status());
  if (new URL(req.url).searchParams.has("points")) return json(await leaderboard());
  return json(await runIndexer({ budgetMs: 50_000, force: true }));
}

export const GET = handle;
export const POST = handle;
