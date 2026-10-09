// GET /api/health → is the API up, and which database is it on?
import { dbKind, query } from "./_lib/db.js";
import { json } from "./_lib/auth.js";

export async function GET(): Promise<Response> {
  try {
    await query(`select 1`);
    return json({ ok: true, db: await dbKind() });
  } catch (e: any) {
    return json({ ok: false, error: "db_unavailable", message: String(e?.message ?? e).slice(0, 200) }, 503);
  }
}
