// POST /api/account/sync → quietly refreshes this account's indexed activity (bridge transfers, wallet
// snapshots, and a few seconds of the chain-wide Vault scan). The app calls it after sign-in and link;
// it is throttled per account so repeated calls cost nothing.
import { createHash } from "node:crypto";
import { fail, guardPost, json, sessionAccount } from "../_lib/auth.js";
import { addressesOf, runIndexer } from "../_lib/indexer/run.js";
import { getState, setState } from "../_lib/indexer/state.js";

const MIN_INTERVAL_MS = 60_000;

export async function POST(req: Request): Promise<Response> {
  const bad = guardPost(req);
  if (bad) return bad;
  const accountId = await sessionAccount(req);
  if (!accountId) return fail(401, "not_signed_in", "Sign in first.");

  // Throttled per account AND wallet set: linking a new wallet syncs it straight away (once), repeats stay free.
  const { all } = await addressesOf(accountId);
  const key = `sync:${accountId}:${createHash("sha256").update([...all].sort().join(",")).digest("hex").slice(0, 12)}`;
  const last = await getState<{ at: number }>(key);
  const wait = last ? MIN_INTERVAL_MS - (Date.now() - last.at) : 0;
  if (wait > 0) return json({ skipped: true, retryInSeconds: Math.ceil(wait / 1000) });

  await setState(key, { at: Date.now() }); // claim the slot before working, so a double click can't pile up
  const summary = await runIndexer({ accountId, budgetMs: 9_000, vaultMs: 3_000 });
  return json({ skipped: false, summary });
}
