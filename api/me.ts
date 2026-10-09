// GET /api/me → { account: null | { id, createdAt, wallets[] } }
// 503 when no database is configured, so the app hides the account UI instead of offering a dead-end sign-in.
import { dbConfigured } from "./_lib/db.js";
import { accountView, fail, json, sessionAccount } from "./_lib/auth.js";

export async function GET(req: Request): Promise<Response> {
  if (!dbConfigured()) return fail(503, "db_unavailable", "Accounts aren't enabled on this deployment.");
  const id = await sessionAccount(req);
  return json({ account: id ? await accountView(id) : null });
}
