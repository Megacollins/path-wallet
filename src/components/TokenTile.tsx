// A polished-stone asset tile — dark marble for stablecoins, rosso for volatile
// assets — with a white token emblem, matching the Ancient-Rome aesthetic.
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatAmount, formatUsdCompact } from "../../lib/format";
import type { AssetBalance } from "../../lib/assets";

const ROSSO = new Set(["SOL", "wSOL", "ETH", "wETH", "BTC", "wBTC"]);

function TokenEmblem({ symbol }: { symbol: string }) {
  const s = symbol.replace(/^w/, "");
  const common = { className: "h-8 w-8 drop-shadow", fill: "none", stroke: "#F3ECDD", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (s === "ETH")
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 2 5 12l7 4 7-4-7-10Z" />
        <path d="M5 13.5 12 22l7-8.5-7 4-7-4Z" />
      </svg>
    );
  if (s === "SOL")
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M6 7h11l-3 3H3l3-3Z" />
        <path d="M6 14h11l-3 3H3l3-3Z" />
      </svg>
    );
  if (s === "USDC")
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M14.5 9.2c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-1.9-.4-2.5-1" />
      </svg>
    );
  return <span className="font-serif text-2xl text-parchment">{s.slice(0, 2)}</span>;
}

export function TokenTile({ asset, index = 0 }: { asset: AssetBalance; index?: number }) {
  const rosso = ROSSO.has(asset.symbol);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ delay: Math.min(index * 0.05, 0.35), type: "spring", stiffness: 300, damping: 22 }}
      className={`${rosso ? "marble-rosso" : "marble"} marble-sheen hover-glow relative flex aspect-square flex-col items-center justify-center gap-2 p-4 text-center`}
    >
      {asset.change24h != null && (
        <span
          className={`absolute right-2.5 top-2.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm ${
            asset.change24h >= 0 ? "bg-emerald-500/20 text-emerald-200" : "bg-black/30 text-terracotta-300"
          }`}
        >
          {asset.change24h >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {Math.abs(asset.change24h).toFixed(1)}%
        </span>
      )}
      {/* legibility scrim so text reads over light (rosso) marble */}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: "radial-gradient(72% 62% at 50% 62%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.15) 62%, transparent 100%)" }} />
      <div className="relative z-10 grid h-12 w-12 place-items-center rounded-full border border-champagne/25 bg-black/30 backdrop-blur-[1px]">
        <TokenEmblem symbol={asset.symbol} />
      </div>
      <div className="relative z-10 font-serif text-lg emboss-gold leading-none">{asset.symbol}</div>
      <div className="relative z-10 leading-tight">
        <div className="tabular text-sm text-parchment">
          {formatAmount(BigInt(Math.round(asset.amount * 10 ** asset.decimals)), asset.decimals)}
        </div>
        <div className="tabular text-[11px] text-parchment/60">{asset.usdValue != null ? formatUsdCompact(asset.usdValue) : "—"}</div>
      </div>
    </motion.div>
  );
}
