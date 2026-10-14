// The admin API, in ONE function (Vercel's free plan caps a deployment at 12 functions). Admins only.
//   GET  /api/admin/index?view=overview                         → users, activity, XP, the Vault and the indexer
//   GET  /api/admin/index?view=accounts&q=&sort=new|points&limit=&offset=   → a page of accounts with wallets and XP
//   GET  /api/admin/index?view=account&id=<uuid>                → one account in full
//   POST /api/admin/index                                       → run the indexer for every wallet now (what the daily job does)
// The run only reads the chain and appends ledger rows, and every write is idempotent, so repeating it is harmless.
import { fail, guardPost, json } from "../_lib/auth.js";
import { accountDetail, listAccounts, overview, requireAdmin } from "../_lib/admin.js";
import { runIndexer } from "../_lib/indexer/run.js";
import { getState, setState } from "../_lib/indexer/state.js";

const MIN_RUN_INTERVAL_MS = 20_000;

export async function GET(req: Request): Promise<Response> {
  const who = await requireAdmin(req);
  if (who instanceof Response) return who;
  const p = new URL(req.url).searchParams;
  switch (p.get("view") ?? "overview") {
    case "overview":
      return json(await overview());
    case "accounts":
      return json(await listAccounts({ q: p.get("q") ?? "", sort: p.get("sort") === "points" ? "points" : "new", limit: Number(p.get("limit") ?? 25), offset: Number(p.get("offset") ?? 0) }));
    case "account": {
      const detail = await accountDetail(p.get("id") ?? "");
      return detail ? json(detail) : fail(404, "not_found", "No such account.");
    }
    default:
      return fail(400, "bad_view", "Unknown view.");
  }
}

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  const who = await requireAdmin(req);
  if (who instanceof Response) return who;
  const last = await getState<{ at: number }>("admin:run");
  if (last && Date.now() - last.at < MIN_RUN_INTERVAL_MS) return fail(429, "too_soon", "A run just started. Give it a few seconds.");
  await setState("admin:run", { at: Date.now() });
  return json(await runIndexer({ budgetMs: 25_000, vaultMs: 8_000, force: true }));
}
