// Tiny key/value store for indexer cursors and throttles.
import { query } from "../db.js";

export async function getState<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const rows = await query(`select value from indexer_state where key = $1`, [key]);
  return (rows[0]?.value as T) ?? null;
}

export async function setState(key: string, value: unknown): Promise<void> {
  await query(
    `insert into indexer_state (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/**
 * Take a "no more often than every `minIntervalMs`" slot in ONE statement, so simultaneous callers can't all pass a
 * separate read-then-write check: exactly one of them gets it. When refused, says how long until the slot frees up.
 */
export async function claimSlot(key: string, minIntervalMs: number): Promise<{ ok: true } | { ok: false; retryInSeconds: number }> {
  const now = Date.now();
  const rows = await query(
    `insert into indexer_state (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()
     where coalesce((indexer_state.value->>'at')::numeric, 0) <= $3
     returning key`,
    [key, JSON.stringify({ at: now }), now - minIntervalMs],
  );
  if (rows[0]) return { ok: true };
  const cur = await getState<{ at?: number }>(key);
  return { ok: false, retryInSeconds: Math.max(1, Math.ceil(((cur?.at ?? now) + minIntervalMs - now) / 1000)) };
}

/** Create a state row only if it doesn't exist yet; returns whichever value is stored afterwards. */
export async function createState<T = Record<string, unknown>>(key: string, value: T): Promise<T> {
  await query(`insert into indexer_state (key, value) values ($1, $2::jsonb) on conflict (key) do nothing`, [key, JSON.stringify(value)]);
  return ((await getState<T>(key)) ?? value) as T;
}

/**
 * Save a scan cursor, but never move it backwards: two overlapping runs (a cron and a user-triggered
 * sync) can finish out of order, and the slower, older one must not rewind the position.
 */
export async function advanceCursor(key: string, value: { next: number; [k: string]: unknown }): Promise<void> {
  await query(
    `insert into indexer_state (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()
     where coalesce((indexer_state.value->>'next')::numeric, -1) <= (excluded.value->>'next')::numeric`,
    [key, JSON.stringify(value)],
  );
}
