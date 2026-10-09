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
