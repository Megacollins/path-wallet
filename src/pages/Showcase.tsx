// "The Vault of Path" — an art-directed, single-screen portfolio. A cinematic
// marble stage: Roman columns in the depth, a gold medallion enshrined in a
// marble arch, and frosted-glass instruments floating in front. Demo data.
import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Plus, ArrowLeftRight } from "lucide-react";
import { formatUsd, formatUsdCompact, shorten } from "../../lib/format";
import { DEMO_CHANGE_24H, DEMO_EVM_ADDRESS, DEMO_PORTFOLIO, DEMO_SOL_ADDRESS, DEMO_SPARKLINE } from "../../lib/demo";
import { GoldMedallion } from "../components/GoldMedallion";
import { AllocationRing, Sparkline } from "../components/Analytics";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { AssetImage } from "../components/AssetImage";
import { PathMark, Wordmark } from "../components/Logo";

const ease = [0.16, 1, 0.3, 1] as const;
const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 26 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, ease, delay },
});

export function Showcase() {
  const p = DEMO_PORTFOLIO;
  const alloc = p.assets.map((a) => ({ symbol: a.symbol, usd: a.usdValue ?? 0, pct: ((a.usdValue ?? 0) / p.totalUsd) * 100 }));
  const top = p.assets.slice(0, 3);

  return (
    <div className="stage vignette relative min-h-screen w-full overflow-hidden text-parchment">
      {/* ---- depth layers ---- */}
      {/* real marble backdrop photo when present, else procedural SVG */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.72]"
        style={{ backgroundImage: "url(/textures/backdrop.jpg), url(/marble-black.svg)", backgroundSize: "cover, cover", backgroundPosition: "center" }}
      />
      {/* cinematic grade: darken center (behind the gold) + edges so it reads as depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(95% 75% at 50% 42%, rgba(6,5,4,0.62) 0%, rgba(6,5,4,0.28) 46%, rgba(6,5,4,0.82) 100%)" }}
      />
      {/* Roman columns: real transparent PNGs when present, else the SVG silhouette */}
      <AssetImage
        src="/textures/column-left.png"
        className="pointer-events-none absolute left-0 top-0 h-full w-auto object-cover opacity-70"
        fallback={<div className="pointer-events-none absolute inset-0 opacity-[0.14]" style={{ backgroundImage: "url(/columns.svg)", backgroundSize: "cover", backgroundPosition: "center top" }} />}
      />
      <AssetImage src="/textures/column-right.png" className="pointer-events-none absolute right-0 top-0 h-full w-auto object-cover opacity-70" fallback={null} />
      <div className="pointer-events-none absolute left-1/2 top-[8%] h-[520px] w-[820px] -translate-x-1/2 rounded-[40%] opacity-30 blur-3xl" style={{ backgroundImage: "url(/textures/marble-black.jpg), url(/marble-black.svg)", backgroundSize: "cover" }} />
      <div className="pointer-events-none absolute left-1/2 top-[12%] h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-champagne/20 blur-[90px]" />

      {/* ---- content ---- */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center px-6 py-12 sm:py-16">
        {/* eyebrow */}
        <motion.div {...rise(0)} className="mb-10 flex items-center gap-4">
          <span className="h-px w-12 bg-gradient-to-r from-transparent to-champagne/60" />
          <span className="font-sans text-[11px] uppercase tracking-[0.42em] text-champagne-200">Path · Private Wealth</span>
          <span className="h-px w-12 bg-gradient-to-l from-transparent to-champagne/60" />
        </motion.div>

        {/* the gold sculpture, enshrined on the stage */}
        <motion.div {...rise(0.1)} className="relative flex items-end justify-center">
          {/* dark pocket so the photo's own background merges into the stage,
              hiding its rectangular edge against the lit marble backdrop */}
          <div
            className="pointer-events-none absolute left-1/2 top-[46%] h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(4,3,3,0.96) 30%, rgba(4,3,3,0.6) 52%, transparent 72%)" }}
          />
          {/* warm halo behind the gold */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-champagne/20 blur-[110px]" />
          <div className="pointer-events-none absolute left-1/2 top-[46%] h-[220px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-gold/15 blur-[60px]" />

          <Sculpture />
        </motion.div>

        {/* balance — gold foil */}
        <motion.div {...rise(0.25)} className="mt-10 text-center">
          <p className="label-eyebrow">Total holdings · both lanes</p>
          <div className="text-foil font-serif text-6xl leading-none sm:text-8xl">
            <AnimatedNumber value={p.totalUsd} format={formatUsd} />
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-300">
              <ArrowUpRight className="h-4 w-4" /> {DEMO_CHANGE_24H.toFixed(2)}% <span className="opacity-60">24h</span>
            </span>
            <span className="chip">🦊 {shorten(DEMO_EVM_ADDRESS, 5, 4)}</span>
            <span className="chip">👻 {shorten(DEMO_SOL_ADDRESS, 5, 4)}</span>
          </div>
        </motion.div>

        {/* floating instruments */}
        <div className="mt-12 grid w-full gap-6 lg:grid-cols-3">
          <motion.div {...rise(0.35)} className="glass-strong depth rounded-3xl p-6">
            <p className="label-eyebrow">Allocation</p>
            <div className="mt-4">
              <AllocationRing data={alloc} size={116} />
            </div>
          </motion.div>

          <motion.div {...rise(0.42)} className="glass-strong depth rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <p className="label-eyebrow">30-day trend</p>
              <span className="text-xs text-emerald-300">▲ {DEMO_CHANGE_24H.toFixed(2)}%</span>
            </div>
            <div className="mt-6">
              <Sparkline points={DEMO_SPARKLINE} />
            </div>
            <div className="mt-5 flex gap-2">
              <button className="btn-gold flex-1"><Plus className="h-4 w-4" /> Deposit</button>
              <button className="btn-ghost flex-1"><ArrowLeftRight className="h-4 w-4" /> Swap</button>
            </div>
          </motion.div>

          <motion.div {...rise(0.5)} className="glass-strong depth rounded-3xl p-6">
            <p className="label-eyebrow">Holdings</p>
            <ul className="mt-4 space-y-3">
              {top.map((a) => (
                <li key={a.symbol} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-champagne/25 bg-black/30 font-serif text-sm text-champagne-100">
                      {a.symbol.replace(/^w/, "").slice(0, 2)}
                    </span>
                    <span className="text-sm text-parchment/85">{a.symbol}</span>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-sm text-parchment">{formatUsdCompact(a.usdValue)}</div>
                    <div className={`text-[11px] ${(a.change24h ?? 0) >= 0 ? "text-emerald-300" : "text-terracotta-300"}`}>
                      {(a.change24h ?? 0) >= 0 ? "+" : ""}{(a.change24h ?? 0).toFixed(2)}%
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>

        {/* footer wordmark */}
        <motion.div {...rise(0.6)} className="mt-14 flex items-center gap-4 opacity-80">
          <Wordmark size={30} />
          <span className="text-xs text-parchment/40">·</span>
          <Link to="/app" className="text-xs text-champagne-200/70 hover:text-champagne-100">Enter the wallet →</Link>
        </motion.div>
      </div>
    </div>
  );
}

// The centerpiece: the real gold-sculpture photo with the Path monogram engraved
// onto its central shield, or the procedural arch + medallion as a fallback.
const SCULPT_MASK = "radial-gradient(78% 74% at 50% 45%, #000 40%, rgba(0,0,0,0.5) 62%, transparent 78%)";

function Sculpture() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="arch gold-frame marble-white relative z-10 h-[380px] w-[300px] overflow-hidden sm:h-[440px] sm:w-[340px]">
        <div className="greek-key absolute inset-x-0 top-0 h-[6px] opacity-70" />
        <div className="arch niche absolute inset-[14px] flex items-center justify-center overflow-hidden" style={{ background: "radial-gradient(80% 70% at 50% 38%, #241d10, #0c0a06 78%)" }}>
          <div className="absolute left-1/2 top-[38%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-champagne/25 blur-3xl" />
          <GoldMedallion size={228} />
        </div>
      </div>
    );
  }
  return (
    <div className="relative z-10 animate-float">
      <img
        src="/textures/gold-sculpture.png"
        alt="Path"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-[320px] w-auto object-contain sm:h-[460px]"
        style={{
          WebkitMaskImage: SCULPT_MASK,
          maskImage: SCULPT_MASK,
          filter: "drop-shadow(0 44px 60px rgba(0,0,0,0.85)) drop-shadow(0 0 80px rgba(201,162,39,0.4))",
        }}
      />
      {/* the monogram, engraved onto the central shield */}
      <div
        className="pointer-events-none absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2"
        style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.7)) drop-shadow(0 0 10px rgba(201,162,39,0.45))" }}
      >
        <PathMark size={120} />
      </div>
    </div>
  );
}
