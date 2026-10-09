// Schema, applied in order and recorded in schema_migrations. Every statement is idempotent
// (`if not exists`), so two cold starts racing each other, or a re-run, are harmless.
// Neon's HTTP driver takes one statement per call, hence arrays of statements.
export const MIGRATIONS: { id: string; statements: string[] }[] = [
  {
    id: "001_accounts",
    statements: [
      // A Path account is just an identity; wallets hang off it.
      `create table if not exists accounts (
         id uuid primary key default gen_random_uuid(),
         created_at timestamptz not null default now()
       )`,
      // `address` is stored normalized: EVM lowercase, Solana base58 as-is. One wallet belongs to
      // exactly one account (the unique key), which is what keeps points from being split or doubled.
      `create table if not exists wallets (
         id uuid primary key default gen_random_uuid(),
         account_id uuid not null references accounts(id) on delete cascade,
         kind text not null check (kind in ('evm','solana')),
         address text not null,
         synthetic_address text,
         linked_at timestamptz not null default now(),
         unique (kind, address)
       )`,
      `create index if not exists wallets_account_idx on wallets (account_id)`,
      // One-time sign-in/link challenges. The exact message the wallet must sign is stored here,
      // so verification compares strings instead of parsing a format.
      `create table if not exists auth_challenges (
         nonce text primary key,
         kind text not null,
         address text not null,
         purpose text not null check (purpose in ('signin','link')),
         account_id uuid references accounts(id) on delete cascade,
         message text not null,
         created_at timestamptz not null default now(),
         expires_at timestamptz not null
       )`,
      `create index if not exists auth_challenges_addr_idx on auth_challenges (kind, address, created_at)`,
      // Only a hash of the session token is stored, so a database leak can't be replayed as logins.
      `create table if not exists sessions (
         token_hash text primary key,
         account_id uuid not null references accounts(id) on delete cascade,
         created_at timestamptz not null default now(),
         expires_at timestamptz not null
       )`,
      `create index if not exists sessions_account_idx on sessions (account_id)`,
    ],
  },
  {
    id: "002_indexer",
    statements: [
      // Everything observed on-chain or via the bridge, keyed by the ACTOR ADDRESS, never by account.
      // Attribution to an account is a join against `wallets` at read time, so a wallet linked later is
      // credited with its whole history, and unlinking/relinking never loses or duplicates an event.
      // `data` keeps the raw source record so rules can be recomputed without re-fetching.
      `create table if not exists chain_events (
         id bigserial primary key,
         source text not null check (source in ('vault','bridge')),
         kind text not null,
         chain_id bigint not null default 0,
         address text not null,
         amount numeric,
         asset text,
         external_id text not null,
         status text,
         occurred_at timestamptz,
         completed_at timestamptz,
         data jsonb not null default '{}'::jsonb,
         first_seen_at timestamptz not null default now(),
         updated_at timestamptz not null default now(),
         unique (source, chain_id, external_id)
       )`,
      `create index if not exists chain_events_addr_idx on chain_events (address, occurred_at desc)`,
      `create index if not exists chain_events_kind_idx on chain_events (kind, occurred_at)`,
      // Resumable cursors and throttles (vault scan position, last bridge sync per wallet, …).
      `create table if not exists indexer_state (
         key text primary key,
         value jsonb not null default '{}'::jsonb,
         updated_at timestamptz not null default now()
       )`,
      // A wallet's Rome transaction count and gas balance, stored only when either changes. The nonce
      // delta between snapshots is the number of transactions the wallet sent — in ANY app on Rome.
      `create table if not exists wallet_snapshots (
         id bigserial primary key,
         address text not null,
         chain_id bigint not null,
         nonce bigint not null,
         gas_balance numeric not null,
         taken_at timestamptz not null default now()
       )`,
      `create index if not exists wallet_snapshots_idx on wallet_snapshots (address, chain_id, taken_at desc)`,
    ],
  },
];
