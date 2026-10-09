// One tiny query interface over Postgres. Production: Neon (DATABASE_URL). Local dev and tests:
// PGlite, a real Postgres running in-process and persisted under .data/, so the same SQL runs in
// both with no database to install. Migrations apply themselves once per process.
import { mkdirSync } from "node:fs";
import { MIGRATIONS } from "./migrations.js";

export type Row = Record<string, any>;
interface Driver {
  name: "neon" | "pglite";
  query(text: string, params: unknown[]): Promise<Row[]>;
}

let opening: Promise<Driver> | null = null;

async function open(): Promise<Driver> {
  const url = process.env.DATABASE_URL?.trim();
  let driver: Driver;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    driver = { name: "neon", query: async (text, params) => (await sql.query(text, params as any[])) as Row[] };
  } else {
    // Never fall back to a throwaway local database on a deployed function.
    if (process.env.VERCEL) throw new Error("DATABASE_URL is not set");
    const dir = process.env.PGLITE_DIR ?? ".data/pglite";
    if (dir !== "memory") mkdirSync(dir, { recursive: true });
    const mod = "@electric-sql/pglite"; // dev-only dependency; keep it out of the function bundle
    const { PGlite } = await import(/* @vite-ignore */ mod);
    const db = new PGlite(dir === "memory" ? undefined : dir);
    driver = { name: "pglite", query: async (text, params) => (await db.query(text, params)).rows as Row[] };
  }
  await migrate(driver);
  return driver;
}

async function migrate(d: Driver) {
  await d.query(`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`, []);
  const done = new Set((await d.query(`select id from schema_migrations`, [])).map((r) => r.id as string));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const stmt of m.statements) await d.query(stmt, []);
    await d.query(`insert into schema_migrations (id) values ($1) on conflict do nothing`, [m.id]);
  }
}

function driver(): Promise<Driver> {
  // A failed open (bad URL, DB down) must not be cached forever.
  opening ??= open().catch((e) => {
    opening = null;
    throw e;
  });
  return opening;
}

export async function query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await driver()).query(text, params) as Promise<T[]>;
}

/** False only where there is nowhere to store anything: a deployed function with no DATABASE_URL. */
export const dbConfigured = () => Boolean(process.env.DATABASE_URL?.trim()) || !process.env.VERCEL;

export async function dbKind(): Promise<"neon" | "pglite"> {
  return (await driver()).name;
}
