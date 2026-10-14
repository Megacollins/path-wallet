// Small fixed-window rate limits kept in the database (so they hold across serverless instances). The caller is
// identified by the address the platform saw (see clientIp); with none (local calls and tests) nothing is limited.
import { clientIp, fail } from "./auth.js";
import { query } from "./db.js";

/** Count one hit for `key` in the current window and return how many hits the window now holds. Atomic. */
export async function hit(key: string, windowMs: number): Promise<number> {
  const bucket = Math.floor(Date.now() / windowMs);
  const rows = await query(
    `insert into rate_limits (key, n, expires_at) values ($1, 1, $2) on conflict (key) do update set n = rate_limits.n + 1 returning n`,
    [`${key}:${bucket}`, new Date((bucket + 2) * windowMs)],
  );
  return Number(rows[0]?.n ?? 1);
}

/** A 429 when this caller has used up `limit` hits of `scope` within `windowMs`, else null. */
export async function limited(req: Request, scope: string, limit: number, windowMs: number): Promise<Response | null> {
  const ip = clientIp(req);
  if (!ip) return null;
  if ((await hit(`${scope}:${ip}`, windowMs)) > limit) return fail(429, "slow_down", "Too many requests. Wait a minute and try again.");
  return null;
}

/** Drop expired rows: run now and then, never on a hot path every time. */
export async function sweepExpired(): Promise<void> {
  await query(`delete from rate_limits where expires_at < now()`);
  await query(`delete from auth_challenges where expires_at < now()`);
  await query(`delete from sessions where expires_at < now()`);
}
