// Realistic sample portfolio for Demo mode. Clearly labeled as demo in the UI —
// never presented as the user's real holdings. Lets the full experience render
// (populated hero, wallet cards, asset tiles, analytics) without a funded wallet.
import type { Hex } from "viem";
import type { AssetBalance, Portfolio } from "./assets.js";

export const DEMO_EVM_ADDRESS = "0x7F4a2b9C1e6D8a3F05b7E2c9A1d4B6f8C0e3A5d2" as Hex;
export const DEMO_SOL_ADDRESS = "5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCkP2UJnM";
export const DEMO_SYNTHETIC = "0xC0a91f4B7d2E6a8035F1c9B4e7A2d5806f3B1e9C" as Hex;

const mk = (
  symbol: string,
  name: string,
  kind: string,
  decimals: number,
  evmAmount: number,
  solAmount: number,
  priceUsd: number,
  change24h: number,
): AssetBalance => {
  const amount = evmAmount + solAmount;
  return {
    symbol,
    name,
    decimals,
    kind,
    evmAddress: "0x0000000000000000000000000000000000000000" as Hex,
    mintId: "",
    evmAmount,
    solAmount,
    amount,
    priceUsd,
    usdValue: amount * priceUsd,
    change24h,
  };
};

const ASSETS: AssetBalance[] = [
  mk("USDC", "Rome USDC (gas)", "gas", 18, 8420.5, 4060.0, 1, 0.01),
  mk("wETH", "Rome Wrapped ETH", "spl_wrapper", 8, 4.15, 2.27, 3184.62, 2.41),
  mk("wSOL", "Rome Wrapped SOL", "spl_wrapper", 9, 38.6, 46.1, 178.94, -1.18),
  mk("wUSDC", "Rome Wrapped USDC", "spl_wrapper", 6, 3200, 1800, 1, 0.0),
];

const totalUsd = ASSETS.reduce((s, a) => s + (a.usdValue ?? 0), 0);

export const DEMO_PORTFOLIO: Portfolio = {
  assets: [...ASSETS].sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0)),
  totalUsd,
  hasUnpriced: false,
};

/** 24h change for the whole portfolio (weighted), as a %. */
export const DEMO_CHANGE_24H = ASSETS.reduce((s, a) => s + (a.change24h ?? 0) * ((a.usdValue ?? 0) / totalUsd), 0);

/** 30 points of portfolio value history, ending at the current total. */
export const DEMO_SPARKLINE: number[] = (() => {
  const pts: number[] = [];
  let v = totalUsd * 0.82;
  for (let i = 0; i < 30; i++) {
    const drift = Math.sin(i / 3.1) * 0.018 + (Math.cos(i / 5.7) * 0.012) + 0.006;
    v = v * (1 + drift);
    pts.push(v);
  }
  pts[pts.length - 1] = totalUsd;
  return pts;
})();

/** Allocation slices for the analytics ring. */
export const DEMO_ALLOCATION = DEMO_PORTFOLIO.assets.map((a) => ({
  symbol: a.symbol,
  usd: a.usdValue ?? 0,
  pct: ((a.usdValue ?? 0) / totalUsd) * 100,
}));
