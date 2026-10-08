// Dual wallet connection UI. MetaMask (EVM) and Phantom (Solana) connect
// independently and simultaneously — each lane has its own row. A network guard
// nudges the EVM wallet onto the Rome chain when needed.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useCfg } from "../network";
import { useWallets } from "../wallet";
import { shortParty } from "../wallet/canton";
import { Copyable } from "./ui";

export function WalletButton() {
  const cfg = useCfg();
  const { evm, solana, canton, anyConnected: romeConnected } = useWallets();
  // The button reflects every connected lane; `anyConnected` itself stays Rome-lanes-only.
  const anyConnected = romeConnected || canton.connected;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const count = (evm.address ? 1 : 0) + (solana.connected ? 1 : 0) + (canton.connected ? 1 : 0);
  const laneLabel = evm.address && solana.connected && !canton.connected ? "Both lanes" : `${count} lane${count === 1 ? "" : "s"}`;
  const needsNetwork = Boolean(evm.address) && !evm.isRome;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`whitespace-nowrap ${anyConnected ? "btn-ghost !px-3 sm:!px-5" : "btn-gold !px-4 sm:!px-5"}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {anyConnected ? (
          <span className="flex items-center gap-2">
            <span className="flex -space-x-1.5">
              {evm.address && <Avatar glyph="🦊" warn={needsNetwork} />}
              {solana.connected && <Avatar glyph="👻" />}
              {canton.connected && <Avatar glyph="🔷" />}
            </span>
            <span className="hidden sm:inline text-sm">{laneLabel}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect wallets</span>
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-[min(92vw,22rem)] card-marble p-4 z-50"
          >
            <p className="label-eyebrow mb-3">Dual-lane wallets</p>
            <LaneRow
              glyph="🦊"
              name="MetaMask"
              lane="EVM lane"
              connected={Boolean(evm.address)}
              connecting={evm.connecting}
              address={evm.address ?? undefined}
              available={evm.available}
              installHref="https://metamask.io/download/"
              onConnect={() => evm.connect()}
              onDisconnect={() => evm.disconnect()}
              warn={needsNetwork ? { label: `Switch to ${cfg.chainName}`, onClick: () => evm.switchToRome() } : undefined}
            />
            <div className="rule-gold my-3" />
            <LaneRow
              glyph="👻"
              name="Phantom"
              lane="Solana lane"
              connected={solana.connected}
              connecting={solana.connecting}
              address={solana.publicKey?.toBase58()}
              available={solana.available}
              installHref="https://phantom.app/download"
              onConnect={() => solana.connect()}
              onDisconnect={() => solana.disconnect()}
            />
            <div className="rule-gold my-3" />
            <CantonRow />
            <p className="text-[11px] text-parchment/40 mt-3 leading-relaxed">
              MetaMask and Phantom drive the <span className="text-gold-200">same</span> Rome state. No faucet — bridge USDC in for gas. Canton is a separate ledger: your own Canton wallet signs, Path only reads.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Avatar({ glyph, warn }: { glyph: string; warn?: boolean }) {
  return (
    <span
      className={`grid place-items-center h-6 w-6 rounded-full bg-stone-800 border text-xs ${
        warn ? "border-terracotta-500" : "border-gold/40"
      }`}
    >
      {glyph}
    </span>
  );
}

function LaneRow({
  glyph,
  name,
  lane,
  connected,
  connecting,
  address,
  available,
  installHref,
  onConnect,
  onDisconnect,
  warn,
}: {
  glyph: string;
  name: string;
  lane: string;
  connected: boolean;
  connecting: boolean;
  address?: string;
  available: boolean;
  installHref: string;
  onConnect: () => void;
  onDisconnect: () => void;
  warn?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid place-items-center h-9 w-9 rounded-full bg-stone-800 border border-gold/25 text-lg shrink-0">{glyph}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="text-sm text-parchment">{name}</span>
          <span className="text-[10px] uppercase tracking-widest text-parchment/40">{lane}</span>
        </div>
        {connected && address ? (
          <Copyable text={address} />
        ) : (
          <span className="text-xs text-parchment/40">{available ? "Not connected" : "Not installed"}</span>
        )}
        {warn && (
          <button onClick={warn.onClick} className="mt-1 block text-[11px] text-terracotta-300 hover:underline">
            ⚠ {warn.label}
          </button>
        )}
      </div>
      {connected ? (
        <button onClick={onDisconnect} className="btn-ghost shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs">
          Disconnect
        </button>
      ) : available ? (
        <button onClick={onConnect} className="btn-gold shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs" disabled={connecting}>
          {connecting ? "…" : "Connect"}
        </button>
      ) : (
        <a href={installHref} target="_blank" rel="noreferrer" className="btn-ghost shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs">
          Install
        </a>
      )}
    </div>
  );
}

/** The Canton lane. Unlike the other two there's no "install" state: the SDK's own picker
 *  finds extension wallets and lets the user enter a gateway URL, so Connect is always offered. */
function CantonRow() {
  const { canton } = useWallets();
  // Look for wallets when the menu opens, so "why isn't my wallet listed?" has a visible answer.
  const { scan, connected } = canton;
  useEffect(() => {
    if (!connected) void scan();
  }, [scan, connected]);
  const found = canton.detected;
  const foundNames = found ? [...found.announced.map((w) => w.name), ...(found.injected ? ["an injected wallet"] : [])] : [];
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="grid place-items-center h-9 w-9 rounded-full bg-stone-800 border border-gold/25 text-lg shrink-0">🔷</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-sm text-parchment">Canton</span>
            <span className="text-[10px] uppercase tracking-widest text-parchment/40">Daml ledger</span>
          </div>
          {canton.connected && canton.primary ? (
            <Copyable text={canton.primary.partyId} display={shortParty(canton.primary.partyId)} />
          ) : canton.connected ? (
            <span className="text-xs text-parchment/40">Connected — no account shared</span>
          ) : (
            <span className="text-xs text-parchment/40">Not connected</span>
          )}
        </div>
        {canton.connected ? (
          <button onClick={() => void canton.disconnect()} className="btn-ghost shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs">
            Disconnect
          </button>
        ) : (
          <button onClick={() => void canton.connect()} className="btn-ghost shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs" disabled={canton.connecting}>
            {canton.connecting ? "…" : "Connect"}
          </button>
        )}
      </div>
      {!canton.connected && found && (
        <p className="mt-2 text-[11px] leading-relaxed text-parchment/45">
          {foundNames.length
            ? `Found in this browser: ${foundNames.join(", ")}.`
            : `No Canton wallet announced itself in this browser (Console Wallet is also checked directly when you press Connect). Use a CIP-0103 wallet extension, or enter a wallet-gateway URL in the picker${canton.walletConnect ? ", or choose WalletConnect for a mobile wallet" : ""}.`}
        </p>
      )}
      {canton.error && <p className="mt-2 break-words text-[11px] text-terracotta-300">{canton.error}</p>}
    </div>
  );
}
