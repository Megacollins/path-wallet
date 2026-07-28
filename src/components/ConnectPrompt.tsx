// Shown across pages when a lane the action needs isn't connected yet.
import { motion } from "framer-motion";
import { Wallet, Sparkles } from "lucide-react";
import { useWallets } from "../wallet";
import { useDemo } from "../demo";
import { PathMark } from "./Logo";
import { Card } from "./ui";

export function ConnectPrompt({
  title = "Connect to begin",
  hint = "Path speaks both lanes — connect MetaMask, Phantom, or both. They drive the same Rome state.",
  showDemo = true,
}: {
  title?: string;
  hint?: string;
  showDemo?: boolean;
}) {
  const { evm, solana } = useWallets();
  const { enable } = useDemo();
  return (
    <Card className="relative overflow-hidden hover-glow">
      <div className="absolute -top-10 -right-6 opacity-10">
        <PathMark size={190} />
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative flex flex-col items-start gap-5">
        <div className="animate-float">
          <PathMark size={60} animated />
        </div>
        <div>
          <h2 className="font-serif text-3xl text-parchment">{title}</h2>
          <p className="mt-1.5 max-w-md text-sm text-parchment/75">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {evm.address ? (
            <span className="chip">🦊 MetaMask connected</span>
          ) : evm.available ? (
            <button className="btn-gold" onClick={() => evm.connect()} disabled={evm.connecting}>
              <Wallet className="h-4 w-4" /> Connect MetaMask
            </button>
          ) : (
            <a className="btn-ghost" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              Install MetaMask
            </a>
          )}
          {solana.connected ? (
            <span className="chip">👻 Phantom connected</span>
          ) : solana.available ? (
            <button className="btn-ghost" onClick={() => solana.connect()} disabled={solana.connecting}>
              <Wallet className="h-4 w-4" /> Connect Phantom
            </button>
          ) : (
            <a className="btn-ghost" href="https://phantom.app/download" target="_blank" rel="noreferrer">
              Install Phantom
            </a>
          )}
        </div>
        {showDemo && (
          <button onClick={enable} className="group inline-flex items-center gap-2 text-sm text-champagne-100/80 hover:text-champagne-100 transition">
            <Sparkles className="h-4 w-4 text-champagne" />
            Explore a live demo
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </button>
        )}
      </motion.div>
    </Card>
  );
}
