// GET /api/admin/account?id=<uuid> → one account in full. Admins only.
import { fail, json } from "../_lib/auth.js";
import { accountDetail, requireAdmin } from "../_lib/admin.js";

export async function GET(req: Request): Promise<Response> {
  const who = await requireAdmin(req);
  if (who instanceof Response) return who;
  const detail = await accountDetail(new URL(req.url).searchParams.get("id") ?? "");
  return detail ? json(detail) : fail(404, "not_found", "No such account.");
}
