// Everything about how XP is presented, in one place. The name is a constant on purpose: calling it "XP",
// "Points" or anything else is a one-line change here (plus the route/nav label in layout.tsx and WalletApp.tsx).
// Devnet XP is a test of the system, not a promise of any reward; keep the copy that way.

export const XP_NAME = "XP";
export const XP_PATH = "/xp";

/** What GET /api/account/points returns. */
export interface XpData {
  season: string;
  rulesVersion: number;
  total: number;
  byRule: { rule: string; points: number; entries: number }[];
  daily: { day: string; points: number }[];
  recent: { rule: string; points: number; day: string | null; address: string | null; at: string }[];
  rules: { rule: string; enabled: boolean; text: string }[];
}

/** Ranks are display-only: derived from the total, never stored. Roman, to match the rest of Path. */
export const RANKS = [
  { name: "Plebeian", from: 0 },
  { name: "Legionary", from: 100 },
  { name: "Centurion", from: 300 },
  { name: "Tribune", from: 700 },
  { name: "Legate", from: 1500 },
  { name: "Senator", from: 3000 },
  { name: "Consul", from: 6000 },
] as const;

export function rankFor(total: number) {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (total >= RANKS[i].from) index = i;
  const rank = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  const progress = next ? (total - rank.from) / (next.from - rank.from) : 1;
  return { index, level: index + 1, rank, next, progress: Math.min(1, Math.max(0, progress)), toNext: next ? next.from - total : 0 };
}

/** Short, human names for the scoring rules (the API's own `rules[].text` gives the full sentence). */
export const RULE_LABELS: Record<string, string> = {
  tx_activity: "Rome transactions",
  active_day: "Active days",
  bridge_in: "Bridge-ins",
  dual_lane: "Both lanes",
  vault: "Vault",
};
export const ruleLabel = (rule: string) => RULE_LABELS[rule] ?? rule;
