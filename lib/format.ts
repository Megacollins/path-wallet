// Small display helpers shared across the app. Pure, no deps beyond viem's
// formatUnits — kept framework-agnostic so scripts and UI both use them.
import { formatUnits } from "viem";

/** Truncate a hex/base58 address: 0x1234…abcd. */
export function shorten(addr: string | undefined, lead = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/** Format a base-unit bigint as a human token amount, trimming trailing zeros. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 4): string {
  const s = formatUnits(value, decimals);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  const withGroups = Number(int).toLocaleString("en-US");
  return trimmed ? `${withGroups}.${trimmed}` : withGroups;
}

/** Format a USD number: $1,234.56, or "—" when unknown. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/** Compact USD for big totals: $1.23K / $4.5M. */
export function formatUsdCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
}

/** Parse a user-typed decimal string into base units for `decimals`. Returns null when invalid. */
export function parseAmountSafe(input: string, decimals: number): bigint | null {
  const t = input.trim();
  if (!t || !/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const [int, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  try {
    const padded = frac.padEnd(decimals, "0");
    return BigInt(int || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  } catch {
    return null;
  }
}
