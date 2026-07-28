// Best-effort USD pricing. Honesty first: stablecoins are pinned to $1, and
// volatile assets (ETH, SOL) are fetched live from a public price API — with a
// graceful fallback to `null` (rendered as "—") when the network is unavailable.
// We NEVER fabricate a price; an unknown price stays unknown.

const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  wETH: "ethereum",
  SOL: "solana",
  wSOL: "solana",
};

const STABLE = new Set(["USDC", "wUSDC", "USDT", "DAI"]);

export type PriceMap = Record<string, number | null>;

let cache: { at: number; prices: PriceMap } | null = null;
const TTL_MS = 60_000;

/** Symbols we can price at $1 without any network call. */
export function stablePrices(symbols: string[]): PriceMap {
  const out: PriceMap = {};
  for (const s of symbols) if (STABLE.has(s)) out[s] = 1;
  return out;
}

/**
 * Resolve USD prices for the given symbols. Stables → $1 instantly; volatile
 * assets → CoinGecko (best-effort, 60s cache). Any symbol that can't be priced
 * is returned as `null`. Never throws.
 */
export async function getPrices(symbols: string[]): Promise<PriceMap> {
  const out: PriceMap = stablePrices(symbols);
  const volatile = symbols.filter((s) => !(s in out) && s in COINGECKO_IDS);
  if (volatile.length === 0) return { ...out, ...unknownFor(symbols, out) };

  if (cache && Date.now() - cache.at < TTL_MS) {
    for (const s of volatile) out[s] = cache.prices[s] ?? null;
    return { ...out, ...unknownFor(symbols, out) };
  }

  try {
    const ids = [...new Set(volatile.map((s) => COINGECKO_IDS[s]))].join(",");
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd: number }>;
      const priced: PriceMap = {};
      for (const s of volatile) priced[s] = data[COINGECKO_IDS[s]]?.usd ?? null;
      cache = { at: Date.now(), prices: priced };
      for (const s of volatile) out[s] = priced[s];
    }
  } catch {
    /* offline / rate-limited — leave volatile as unknown */
  }
  return { ...out, ...unknownFor(symbols, out) };
}

function unknownFor(symbols: string[], have: PriceMap): PriceMap {
  const out: PriceMap = {};
  for (const s of symbols) if (!(s in have)) out[s] = null;
  return out;
}
