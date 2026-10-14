// GET /api/admin/accounts?q=&sort=new|points&limit=&offset= → a page of accounts with their wallets and XP. Admins only.
import { json } from "../_lib/auth.js";
import { listAccounts, requireAdmin } from "../_lib/admin.js";

export async function GET(req: Request): Promise<Response> {
  const who = await requireAdmin(req);
  if (who instanceof Response) return who;
  const p = new URL(req.url).searchParams;
  return json(await listAccounts({ q: p.get("q") ?? "", sort: p.get("sort") === "points" ? "points" : "new", limit: Number(p.get("limit") ?? 25), offset: Number(p.get("offset") ?? 0) }));
}
