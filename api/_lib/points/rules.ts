// The points rules, in one place. Devnet for now: points are a test of the system, not a promise of anything.
//
// Changing a number here changes what is awarded going forward. To re-score the whole recorded history under
// new rules, start a new SEASON (set POINTS_SEASON): the ledger is append-only, seasons sit side by side, and
// scoring replays the recorded events, so nothing is ever edited or lost.

export const RULES_VERSION = 1;

/** Which scoring run these points belong to. A new season is a clean re-score from the recorded events. */
export const currentSeason = () => process.env.POINTS_SEASON?.trim() || "devnet-1";

export interface Rules {
  /** Every transaction a wallet sends on Rome (any app), counted from its transaction-count (nonce) change. */
  tx_activity: { enabled: boolean; perTx: number; dailyCapPerWallet: number };
  /** A day (UTC) on which a wallet sent at least one Rome transaction. Rewards coming back, resists spam. */
  active_day: { enabled: boolean; points: number };
  /** A bridge-in that completed (settled on Rome). Rome sponsors the settlement, so it never shows in the wallet's own count. */
  bridge_in: { enabled: boolean; points: number; minAmountBaseUnits: number; dailyCapPerWallet: number };
  /** One-time: both lanes linked to the account, and each lane has made a Rome transaction. */
  dual_lane: { enabled: boolean; points: number };
  /** Vault deposits and withdrawals. Defined but off: the wrapped-token bug on Rome blocks the Vault right now. */
  vault: { enabled: boolean; points: number; dailyCapPerWallet: number };
}

export const RULES: Rules = {
  tx_activity: { enabled: true, perTx: 1, dailyCapPerWallet: 20 },
  active_day: { enabled: true, points: 5 },
  bridge_in: { enabled: true, points: 25, minAmountBaseUnits: 1_000_000, dailyCapPerWallet: 3 }, // 1 USDC (6 decimals)
  dual_lane: { enabled: true, points: 50 },
  vault: { enabled: false, points: 10, dailyCapPerWallet: 2 },
};

/** Plain-English description of the rules, for the account's own points view. */
export function describeRules(r: Rules = RULES) {
  return [
    { rule: "tx_activity", enabled: r.tx_activity.enabled, text: `${r.tx_activity.perTx} point per transaction your wallet sends on Rome, up to ${r.tx_activity.dailyCapPerWallet} a day per wallet` },
    { rule: "active_day", enabled: r.active_day.enabled, text: `${r.active_day.points} points for each day (UTC) a wallet sends at least one transaction` },
    { rule: "bridge_in", enabled: r.bridge_in.enabled, text: `${r.bridge_in.points} points per completed bridge-in of at least ${r.bridge_in.minAmountBaseUnits / 1e6} USDC, up to ${r.bridge_in.dailyCapPerWallet} a day per wallet` },
    { rule: "dual_lane", enabled: r.dual_lane.enabled, text: `${r.dual_lane.points} points once, when both lanes (EVM and Solana) are linked and each has sent a transaction` },
    { rule: "vault", enabled: r.vault.enabled, text: `${r.vault.points} points per Vault deposit or withdrawal, up to ${r.vault.dailyCapPerWallet} a day per wallet` },
  ];
}
