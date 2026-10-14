// GET /api/admin/overview → users, activity, XP, the Vault and the indexer in one view. Admins only.
import { json } from "../_lib/auth.js";
import { overview, requireAdmin } from "../_lib/admin.js";

export async function GET(req: Request): Promise<Response> {
  const who = await requireAdmin(req);
  if (who instanceof Response) return who;
  return json(await overview());
}
