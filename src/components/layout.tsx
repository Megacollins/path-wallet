// The responsive frame. Desktop (lg+): persistent left sidebar. Tablet: a
// slide-in drawer. Mobile (<sm): top bar + bottom navigation. Built mobile-first.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { LayoutGrid, SendHorizonal, Landmark, Compass, Settings2, Waypoints, Menu, X, type LucideIcon } from "lucide-react";
import { cfg } from "../config";
import { useDemo } from "../demo";
import { PathMark, Wordmark } from "./Logo";
import { WalletButton } from "./WalletControls";

/* ---------------------------------------------------------- nav icons */
const ICONS: Record<NavItem["icon"], LucideIcon> = {
  dashboard: LayoutGrid,
  send: SendHorizonal,
  bridge: Waypoints,
  vault: Landmark,
  apps: Compass,
  settings: Settings2,
};

function Icon({ name, className = "h-5 w-5" }: { name: NavItem["icon"]; className?: string }) {
  const Cmp = ICONS[name];
  return <Cmp className={className} strokeWidth={1.6} />;
}

export interface NavItem {
  to: string;
  label: string;
  icon: "dashboard" | "send" | "bridge" | "vault" | "apps" | "settings";
}

export const NAV: NavItem[] = [
  { to: "/app", label: "Portfolio", icon: "dashboard" },
  { to: "/send", label: "Send", icon: "send" },
  { to: "/bridge", label: "Bridge", icon: "bridge" },
  { to: "/vault", label: "Vault", icon: "vault" },
  { to: "/apps", label: "Ecosystem", icon: "apps" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

/* -------------------------------------------------------- ChainBadge */
function ChainBadge() {
  return (
    <div className="chip w-full justify-center !py-1.5">
      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-glowgold" />
      <span className="truncate">
        {cfg.chainName} · <span className="text-parchment/50">{cfg.network}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------- SidebarNav */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/app"}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all ${
              isActive ? "text-stone-950 font-medium" : "text-parchment/70 hover:text-parchment hover:bg-stone-800/50"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-xl bg-gold-sheen shadow-gold"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">
                <Icon name={item.icon} />
              </span>
              <span className="relative z-10">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/* ---------------------------------------------------------- AppShell */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Desktop persistent sidebar */}
      <aside className="marble-panel hidden lg:flex flex-col gap-6 border-r border-gold/15 px-5 py-6 sticky top-0 h-screen">
        <Link to="/" className="px-1" title="Path — home">
          <Wordmark size={38} />
        </Link>
        <SidebarNav />
        <div className="mt-auto flex flex-col gap-3">
          <ChainBadge />
          <p className="px-1 text-[11px] text-parchment/30 leading-relaxed">
            Path · a dual-lane smart wallet on <span className="text-gold-200/70">Rome</span>. EVM & Solana, one state.
          </p>
          {/* classical columns at the foot of the sidebar */}
          <div
            className="pointer-events-none mt-1 h-24 opacity-[0.35]"
            style={{ backgroundImage: "url(/columns.svg)", backgroundSize: "auto 130%", backgroundRepeat: "no-repeat", backgroundPosition: "bottom center", WebkitMaskImage: "linear-gradient(180deg, transparent, #000 45%)", maskImage: "linear-gradient(180deg, transparent, #000 45%)" }}
          />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-col">
        {/* Top bar */}
        <header className="glass sticky top-0 z-30 flex items-center justify-between gap-3 !border-x-0 !border-t-0 px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawer(true)}
              className="lg:hidden grid place-items-center h-10 w-10 rounded-2xl border border-champagne/20 text-parchment/80 hover:bg-stone-800/60"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" strokeWidth={1.6} />
            </button>
            <Link to="/" className="lg:hidden" title="Path — home">
              <Wordmark size={30} />
            </Link>
            <div className="hidden lg:block">
              <ChainBadge />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DemoBadge />
            <WalletButton />
          </div>
        </header>

        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-12 lg:pb-12">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>

      {/* Tablet / mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="marble-panel fixed inset-y-0 left-0 z-50 w-72 max-w-[82vw] flex flex-col gap-6 border-r border-gold/15 px-5 py-6 lg:hidden"
            >
              <div className="flex items-center justify-between">
                <Link to="/" title="Path — home">
                  <Wordmark size={34} />
                </Link>
                <button onClick={() => setDrawer(false)} className="text-parchment/50 hover:text-parchment" aria-label="Close menu">
                  <X className="h-5 w-5" strokeWidth={1.6} />
                </button>
              </div>
              <SidebarNav onNavigate={() => setDrawer(false)} />
              <div className="mt-auto">
                <ChainBadge />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Mobile floating glass bottom nav */}
      <nav className="glass-strong fixed bottom-4 inset-x-4 z-30 flex items-center justify-around rounded-3xl px-2 py-2 shadow-lux sm:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/app"}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[10px] transition-colors ${
                isActive ? "text-stone-950" : "text-parchment/55"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span layoutId="bottomnav-active" className="absolute inset-0 rounded-2xl bg-gold-sheen" transition={{ type: "spring", stiffness: 380, damping: 30 }} />
                )}
                <span className="relative z-10">
                  <Icon name={item.icon} className="h-5 w-5" />
                </span>
                <span className="relative z-10 font-medium">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <MobileLogoWatermark />
    </div>
  );
}

function DemoBadge() {
  const { demo, disable } = useDemo();
  if (!demo) return null;
  return (
    <button
      onClick={disable}
      className="chip !border-champagne/40 !text-champagne-100 hover:!border-champagne/70"
      title="Exit demo mode"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-champagne animate-pulse" />
      Demo · exit
    </button>
  );
}

function MobileLogoWatermark() {
  return (
    <>
      {/* faint classical columns framing the stage */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.06]"
        style={{ backgroundImage: "url(/columns.svg)", backgroundSize: "cover", backgroundPosition: "top center" }}
      />
      <div className="pointer-events-none fixed -bottom-8 -right-8 z-0 opacity-[0.04] sm:opacity-[0.05]">
        <PathMark size={220} />
      </div>
    </>
  );
}
