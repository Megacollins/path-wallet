// POST /api/auth/logout → ends this browser's session.
import { clearCookie, endSession, guardPost, json } from "../_lib/auth.js";

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  await endSession(req);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(req) });
}
