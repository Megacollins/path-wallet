// GET /api/me → { account: null | { id, createdAt, wallets[] } }
import { accountView, json, sessionAccount } from "./_lib/auth.js";

export async function GET(req: Request): Promise<Response> {
  const id = await sessionAccount(req);
  return json({ account: id ? await accountView(id) : null });
}
