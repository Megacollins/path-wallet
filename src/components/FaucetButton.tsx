// "Fund your wallet" banner shown on the dashboard when a real EVM wallet is
// connected. Primary path is bridging USDC in (always available). The one-click
// faucet claim only appears when an operator has actually configured a faucet
// endpoint (VITE_FAUCET_URL) — otherwise it stays hidden so nothing looks broken.
import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Droplets, Waypoints } from "lucide-react";
import type { Hex } from "viem";
import { useToast } from "./Toast";
import { Button } from "./ui";

// Empty unless the operator sets it — so the faucet button is off by default.
const FAUCET_URL = (import.meta.env.VITE_FAUCET_URL as string | undefined)?.trim() || "";

export function StarterGasBanner({ address, onFunded }: { address: Hex; onFunded?: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function claim() {
    setBusy(true);
    const id = toast.push({ kind: "pending", title: "Claiming starter gas", message: "Sending USDC to your wallet…" });
    try {
      const res = await fetch(FAUCET_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Faucet error (${res.status})`);
      toast.update(id, { kind: "success", title: `Received ${data.amountUsdc ?? ""} USDC`, message: "Starter gas is in your wallet.", href: data.explorer });
      setDone(true);
      setTimeout(() => onFunded?.(), 2500);
    } catch (e: any) {
      toast.update(id, { kind: "error", title: "Couldn't claim gas", message: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass depth flex flex-wrap items-center justify-between gap-4 rounded-3xl p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-sheen text-stone-950 shadow-gold">
          <Waypoints className="h-5 w-5" />
        </span>
        <div>
          <p className="font-serif text-lg text-parchment">New to Rome? Fund your wallet</p>
          <p className="text-xs text-parchment/55">Gas on Rome is USDC — bring some in to start transacting.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {FAUCET_URL && (
          <Button variant="ghost" onClick={claim} loading={busy}>
            <Droplets className="h-4 w-4" /> {busy ? "Claiming…" : "Claim starter gas"}
          </Button>
        )}
        <Link to="/bridge" className="btn-gold">
          <Waypoints className="h-4 w-4" /> Bridge USDC in
        </Link>
      </div>
    </motion.div>
  );
}
