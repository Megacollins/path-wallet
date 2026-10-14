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
  tx_activity: {
    enabled: boolean;
    perTx: number;
    /** null = every transaction counts, no per-wallet daily limit. */
    dailyCapPerWallet: number | null;
    /** The most this activity can pay one ACCOUNT (all its wallets together) per UTC day: what a throwaway account can farm. null = none. */
    dailyCapPerAccount: number | null;
  };
  /** A day (UTC) on which a wallet sent at least `minTxs` Rome transactions. Rewards coming back; one-off pings don't count. */
  active_day: { enabled: boolean; points: number; minTxs: number };
  /** A bridge-in that completed (settled on Rome). Rome sponsors the settlement, so it never shows in the wallet's own count. */
  bridge_in: { enabled: boolean; points: number; minAmountBaseUnits: number; dailyCapPerWallet: number };
  /** One-time: both lanes linked to the account, and each lane has sent at least `minTxsPerLane` Rome transactions. */
  dual_lane: { enabled: boolean; points: number; minTxsPerLane: number };
  /** Vault deposits and withdrawals. Defined but off: the wrapped-token bug on Rome blocks the Vault right now. */
  vault: { enabled: boolean; points: number; dailyCapPerWallet: number; /** Events below this amount (6-decimal base units) are ignored, so a zero-value call earns nothing. */ minAmountBaseUnits: number };
}

export const RULES: Rules = {
  tx_activity: { enabled: true, perTx: 1, dailyCapPerWallet: null, dailyCapPerAccount: 100 },
  active_day: { enabled: true, points: 5, minTxs: 2 },
  bridge_in: { enabled: true, points: 25, minAmountBaseUnits: 1_000_000, dailyCapPerWallet: 3 }, // 1 USDC (6 decimals)
  dual_lane: { enabled: true, points: 50, minTxsPerLane: 5 },
  vault: { enabled: false, points: 10, dailyCapPerWallet: 2, minAmountBaseUnits: 10_000 }, // 0.01 wUSDC
};

/**
 * Plain-English description of the rules, for the account's own points view. The unit is written as the placeholder
 * {xp}: the app substitutes whatever it calls points (see src/lib/xp.ts), so renaming never touches the server.
 */
export function describeRules(r: Rules = RULES) {
  return [
    { rule: "tx_activity", enabled: r.tx_activity.enabled, text: `${r.tx_activity.perTx} {xp} for every transaction your wallet sends on Rome${r.tx_activity.dailyCapPerWallet == null ? "" : `, up to ${r.tx_activity.dailyCapPerWallet} a day per wallet`}${r.tx_activity.dailyCapPerAccount == null ? "" : `, up to ${r.tx_activity.dailyCapPerAccount} a day per account`}` },
    { rule: "active_day", enabled: r.active_day.enabled, text: `${r.active_day.points} {xp} for each day (UTC) a wallet sends at least ${r.active_day.minTxs} transaction${r.active_day.minTxs === 1 ? "" : "s"}` },
    { rule: "bridge_in", enabled: r.bridge_in.enabled, text: `${r.bridge_in.points} {xp} per completed bridge-in of at least ${r.bridge_in.minAmountBaseUnits / 1e6} USDC, up to ${r.bridge_in.dailyCapPerWallet} a day per wallet` },
    { rule: "dual_lane", enabled: r.dual_lane.enabled, text: `${r.dual_lane.points} {xp} once, when both lanes (EVM and Solana) are linked and each has sent at least ${r.dual_lane.minTxsPerLane} transactions` },
    { rule: "vault", enabled: r.vault.enabled, text: `${r.vault.points} {xp} per Vault deposit or withdrawal of at least ${r.vault.minAmountBaseUnits / 1e6} wUSDC, up to ${r.vault.dailyCapPerWallet} a day per wallet` },
  ];
}
