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
];
