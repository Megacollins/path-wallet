// POST /api/account/sync → quietly refreshes this account's indexed activity (bridge transfers, wallet
// snapshots, and a few seconds of the chain-wide Vault scan). The app calls it after sign-in and link;
// it is throttled per account so repeated calls cost nothing.
import { createHash } from "node:crypto";
import { fail, guardPost, json, sessionAccount } from "../_lib/auth.js";
import { addressesOf, runIndexer } from "../_lib/indexer/run.js";
import { claimSlot } from "../_lib/indexer/state.js";
import { hit } from "../_lib/limits.js";

const MIN_INTERVAL_MS = 60_000;
/** Across ALL accounts: user-triggered full passes allowed per minute (each fans out to Rome's RPC and the bridge API). */
const GLOBAL_PER_MINUTE = 20;

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  const accountId = await sessionAccount(req);
  if (!accountId) return fail(401, "not_signed_in", "Sign in first.");

  // Throttled per account AND wallet set: linking a new wallet syncs it straight away (once), repeats stay free.
  const { all } = await addressesOf(accountId);
  const key = `sync:${accountId}:${createHash("sha256").update([...all].sort().join(",")).digest("hex").slice(0, 12)}`;
  const slot = await claimSlot(key, MIN_INTERVAL_MS); // one statement: simultaneous calls can't all get through
  if (!slot.ok) return json({ skipped: true, retryInSeconds: slot.retryInSeconds });
  // Many accounts together must not be able to hammer Rome's services: a shared per-minute budget on top.
  if ((await hit("sync-global", 60_000)) > GLOBAL_PER_MINUTE) return json({ skipped: true, retryInSeconds: 30 });
  // The chain-wide Vault scan is the same work for everyone, so user syncs share one slot per minute for it.
  const vaultMs = (await claimSlot("sync:vault", 60_000)).ok ? 3_000 : 0;
  const summary = await runIndexer({ accountId, budgetMs: 9_000, vaultMs });
  return json({ skipped: false, summary });
}
