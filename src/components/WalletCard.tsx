// A physical-looking marble payment card for a connected lane — gold chip,
// embossed wallet name, and the Path mark debossed into the stone.
import { motion } from "framer-motion";
import { shorten } from "../../lib/format";
import { PathMark } from "./Logo";

export function WalletCard({
  variant = "black",
  glyph,
  name,
  lane,
  connected,
  connecting,
  available,
  address,
  installHref,
  onConnect,
  onDisconnect,
  warn,
}: {
  variant?: "black" | "rosso";
  glyph: string;
  name: string;
  lane: string;
  connected: boolean;
  connecting?: boolean;
  available: boolean;
  address?: string;
  installHref: string;
  onConnect: () => void;
  onDisconnect: () => void;
  warn?: { label: string; onClick: () => void };
}) {
  const surface = variant === "rosso" ? "marble-rosso" : "marble";
  return (
    <motion.div
      whileHover={{ y: -4, rotateX: 2 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={`${surface} scallop-card marble-sheen relative flex aspect-[1.62/1] flex-col justify-between p-5`}
      style={{ transformStyle: "preserve-3d", filter: "drop-shadow(0 24px 34px rgba(0,0,0,0.85))" }}
    >
      {/* debossed Path mark */}
      <div className="pointer-events-none absolute right-3 bottom-2 opacity-[0.14]">
        <PathMark size={104} />
      </div>
      {/* legibility scrim so text reads over light (rosso) marble */}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-t from-black/75 via-black/20 to-transparent" />

      <div className="relative flex items-start justify-between">
        <div className="gold-chip" />
        <span className="text-2xl drop-shadow">{glyph}</span>
      </div>

      <div className="relative">
        <div className="font-serif text-xl emboss-gold">{name}</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-parchment/50">{lane}</div>

        <div className="mt-2 flex items-center gap-2">
          {connected && address ? (
            <>
              <span className="font-mono text-xs text-parchment/70">{shorten(address, 6, 4)}</span>
              <button onClick={onDisconnect} className="text-[10px] text-parchment/40 underline hover:text-parchment/70">
                disconnect
              </button>
            </>
          ) : available ? (
            <button onClick={onConnect} className="btn-gold !px-3 !py-1 text-xs" disabled={connecting}>
              {connecting ? "Connecting…" : "Connect"}
            </button>
          ) : (
            <a href={installHref} target="_blank" rel="noreferrer" className="btn-ghost !px-3 !py-1 text-xs">
              Install
            </a>
          )}
        </div>
        {warn && (
          <button onClick={warn.onClick} className="mt-1 block text-[10px] text-terracotta-300 underline">
            ⚠ {warn.label}
          </button>
        )}
      </div>
    </motion.div>
  );
}
