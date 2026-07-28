// Shared visual primitives for the Strong Ancient Rome design system.
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import { shorten } from "../../lib/format";

/* --------------------------------------------------------------- Card */
export function Card({
  children,
  className = "",
  as: _as,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement> & { as?: string }) {
  return (
    <div className={`card-marble p-5 sm:p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="label-eyebrow">{children}</div>;
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl sm:text-2xl text-parchment">{children}</h2>
      {sub && <p className="mt-1 text-sm text-parchment/50">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------- Button */
type Variant = "gold" | "ghost" | "terra";
export function Button({
  variant = "gold",
  loading = false,
  children,
  className = "",
  ...rest
}: { variant?: Variant; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = variant === "gold" ? "btn-gold" : variant === "terra" ? "btn-terra" : "btn-ghost";
  return (
    <button className={`${cls} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------- TokenGlyph */
const GLYPH_TINT: Record<string, string> = {
  USDC: "from-emerald-300/30 to-emerald-600/10 text-emerald-200",
  wUSDC: "from-gold-200/30 to-gold-700/10 text-gold-100",
  wETH: "from-indigo-300/30 to-indigo-600/10 text-indigo-200",
  wSOL: "from-fuchsia-300/30 to-fuchsia-600/10 text-fuchsia-200",
};
export function TokenGlyph({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const tint = GLYPH_TINT[symbol] ?? "from-parchment/20 to-parchment/5 text-parchment";
  return (
    <div
      className={`grid place-items-center rounded-full bg-gradient-to-br ${tint} border border-gold/20 font-serif font-semibold shadow-carve`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {symbol.replace(/^w/, "").slice(0, 2)}
    </div>
  );
}

/* --------------------------------------------------------- Copyable */
export function Copyable({ text, display, className = "" }: { text: string; display?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={`group inline-flex items-center gap-1.5 font-mono text-xs text-parchment/60 hover:text-gold-100 transition ${className}`}
      title="Copy"
    >
      {display ?? shorten(text)}
      <span className="text-gold/70">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

/* --------------------------------------------------------- Skeleton */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-stone-700/40 ${className}`}
      style={{
        backgroundImage: "linear-gradient(90deg, transparent 0%, rgba(201,162,39,0.08) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
      }}
    >
      <div className="animate-shimmer h-full w-full" />
    </div>
  );
}

/* -------------------------------------------------------- EmptyState */
export function EmptyState({ glyph, title, hint }: { glyph: string; title: string; hint?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-12 text-center"
    >
      <div className="text-4xl mb-3 opacity-70">{glyph}</div>
      <p className="text-parchment/80 font-serif text-lg">{title}</p>
      {hint && <p className="text-parchment/45 text-sm mt-1 max-w-sm">{hint}</p>}
    </motion.div>
  );
}

/* -------------------------------------------------------- LaneBadge */
export function LaneBadge({ lane }: { lane: "evm" | "solana" }) {
  return lane === "evm" ? (
    <span className="chip !border-indigo-300/30 !text-indigo-200">🦊 MetaMask · EVM</span>
  ) : (
    <span className="chip !border-fuchsia-300/30 !text-fuchsia-200">👻 Phantom · Solana</span>
  );
}
