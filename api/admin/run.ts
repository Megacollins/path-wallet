// POST /api/admin/run → run the indexer for every wallet right now (what the daily job does), then score. Admins only.
// It only reads the chain and appends ledger rows, and every write is idempotent, so running it twice is harmless.
import { fail, guardPost, json } from "../_lib/auth.js";
import { requireAdmin } from "../_lib/admin.js";
import { runIndexer } from "../_lib/indexer/run.js";
import { getState, setState } from "../_lib/indexer/state.js";

const MIN_INTERVAL_MS = 20_000;

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  const who = await requireAdmin(req);
  if (who instanceof Response) return who;
  const last = await getState<{ at: number }>("admin:run");
  if (last && Date.now() - last.at < MIN_INTERVAL_MS) return fail(429, "too_soon", "A run just started. Give it a few seconds.");
  await setState("admin:run", { at: Date.now() });
  return json(await runIndexer({ budgetMs: 25_000, vaultMs: 8_000, force: true }));
}
