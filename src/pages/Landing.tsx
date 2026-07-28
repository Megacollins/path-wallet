// The marketing landing page — Path's front door in the Rome ecosystem.
// Full-bleed cinematic stage (rendered outside the app chrome). The wallet app
// lives at /app; this page sells it.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Wallet, Coins, Droplets, ShieldCheck, ExternalLink } from "lucide-react";
import { cfg } from "../config";
import { useDemo } from "../demo";
import { PathMark, Wordmark } from "../components/Logo";
import { GoldMedallion } from "../components/GoldMedallion";

const ease = [0.16, 1, 0.3, 1] as const;
const rise = (delay = 0) => ({ initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, ease, delay } });
const SCULPT_MASK = "radial-gradient(78% 74% at 50% 45%, #000 42%, rgba(0,0,0,0.5) 64%, transparent 80%)";

const FEATURES = [
  { icon: Wallet, title: "Two wallets, one identity", body: "Connect MetaMask and Phantom at once. Both drive the same contracts and the same state on Rome — no separate accounts." },
  { icon: Coins, title: "Unified portfolio", body: "On Rome an SPL token is its ERC-20 — the same account. One balance, both lanes, no bridging or sync delay." },
  { icon: Droplets, title: "Frictionless gas", body: "One-click starter gas, or bridge USDC in from six testnets via Circle CCTP — no faucet hunt, no CLI." },
  { icon: ShieldCheck, title: "Modular smart account", body: "A smart account owned by both lanes, with a module system ready for session keys, recovery, and spend limits." },
];

export function Landing() {
  const navigate = useNavigate();
  const { enable } = useDemo();
  const tryDemo = () => { enable(); navigate("/app"); };

  return (
    <div className="stage vignette relative min-h-screen w-full overflow-hidden text-parchment">
      {/* depth */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.6]" style={{ backgroundImage: "url(/textures/backdrop.jpg), url(/marble-black.svg)", backgroundSize: "cover", backgroundPosition: "center" }} />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(90% 70% at 70% 20%, rgba(6,5,4,0.5) 0%, rgba(6,5,4,0.2) 45%, rgba(6,5,4,0.86) 100%)" }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "url(/columns.svg)", backgroundSize: "cover", backgroundPosition: "top center" }} />

      {/* header */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark size={34} />
        <div className="flex items-center gap-2">
          <a href="https://docs.rome.builders" target="_blank" rel="noreferrer" className="btn-ghost hidden sm:inline-flex text-sm">Docs</a>
          <Link to="/app" className="btn-gold text-sm">Launch app</Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-6 pt-8 pb-16 lg:grid-cols-[1.1fr_0.9fr] lg:pt-14">
        <div>
          <motion.div {...rise(0)} className="chip mb-5 w-fit">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live on {cfg.chainName} · {cfg.network}
          </motion.div>
          <motion.h1 {...rise(0.06)} className="font-serif text-5xl leading-[1.05] text-parchment sm:text-6xl lg:text-7xl">
            One wallet.<br />Two lanes.<br /><span className="text-foil">One Rome.</span>
          </motion.h1>
          <motion.p {...rise(0.14)} className="mt-6 max-w-md text-base leading-relaxed text-parchment/65">
            Path is a dual-lane smart wallet on Rome — where <span className="text-champagne-100">EVM runs natively on Solana</span>. MetaMask and Phantom drive the same accounts, the same state. No bridges between them.
          </motion.p>
          <motion.div {...rise(0.22)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/app" className="btn-gold text-base !px-6 !py-3">Launch app <ArrowRight className="h-4 w-4" /></Link>
            <button onClick={tryDemo} className="btn-ghost text-base !px-6 !py-3"><Sparkles className="h-4 w-4 text-champagne" /> Explore live demo</button>
          </motion.div>
          <motion.div {...rise(0.3)} className="mt-8 flex items-center gap-5 text-xs text-parchment/40">
            <span>🦊 MetaMask</span><span>👻 Phantom</span><span>◎ Solana</span><span>⟠ EVM</span>
          </motion.div>
        </div>

        {/* gold sculpture */}
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, ease }} className="relative mx-auto flex items-center justify-center">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-champagne/20 blur-[110px]" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "radial-gradient(circle, rgba(4,3,3,0.9) 30%, transparent 70%)" }} />
          <HeroSculpture />
        </motion.div>
      </section>

      {/* features */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-16">
        <motion.div {...rise(0)} className="mb-8 text-center">
          <p className="label-eyebrow">Why Path</p>
          <h2 className="mt-2 font-serif text-3xl text-parchment sm:text-4xl">A single, luxurious surface for Rome</h2>
        </motion.div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} {...rise(i * 0.06)} className="card-marble hover-glow !p-6">
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-gold-sheen text-stone-950 shadow-gold">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="font-serif text-lg text-parchment">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-parchment/55">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* closing CTA */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20">
        <motion.div {...rise(0)} className="card-marble relative overflow-hidden !p-10 text-center">
          <div className="pointer-events-none absolute -right-16 -top-16 opacity-10"><PathMark size={220} /></div>
          <div className="relative">
            <h2 className="font-serif text-3xl text-parchment sm:text-4xl">Ready to walk the Path?</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-parchment/60">Connect a wallet, or explore the full experience with live demo data — no wallet required.</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link to="/app" className="btn-gold text-base !px-6 !py-3">Launch app <ArrowRight className="h-4 w-4" /></Link>
              <button onClick={tryDemo} className="btn-ghost text-base !px-6 !py-3"><Sparkles className="h-4 w-4 text-champagne" /> Live demo</button>
            </div>
          </div>
        </motion.div>

        <footer className="mt-10 border-t border-gold/10 pt-6 text-xs text-parchment/40">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Wordmark size={26} />
            <div className="flex items-center gap-5">
              <a href="https://docs.rome.builders" target="_blank" rel="noreferrer" className="hover:text-champagne-100 inline-flex items-center gap-1">Rome docs <ExternalLink className="h-3 w-3" /></a>
              <a href="https://github.com/rome-protocol" target="_blank" rel="noreferrer" className="hover:text-champagne-100 inline-flex items-center gap-1">GitHub <ExternalLink className="h-3 w-3" /></a>
              <Link to="/showcase" className="hover:text-champagne-100">Showcase</Link>
            </div>
            <span>Path · dual-lane smart wallet on Rome</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gold/5 pt-4 text-[11px] text-parchment/30">
            <span>&copy; {new Date().getFullYear()} Path. Built on Rome Protocol.</span>
            <span>Rome Hadrian &middot; devnet — testnet assets only, no real funds.</span>
          </div>
        </footer>
      </section>
    </div>
  );
}

function HeroSculpture() {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="relative animate-float"><GoldMedallion size={260} /></div>;
  return (
    <div className="relative animate-float">
      <img
        src="/textures/gold-sculpture.png"
        alt="Path"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-[340px] w-auto object-contain sm:h-[440px]"
        style={{ WebkitMaskImage: SCULPT_MASK, maskImage: SCULPT_MASK, filter: "drop-shadow(0 40px 60px rgba(0,0,0,0.85)) drop-shadow(0 0 80px rgba(201,162,39,0.4))" }}
      />
      <div className="pointer-events-none absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2" style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.7)) drop-shadow(0 0 10px rgba(201,162,39,0.45))" }}>
        <PathMark size={104} />
      </div>
    </div>
  );
}
