// Unified portfolio — the hero screen. Animated total, 24h trend, allocation
// analytics, physical marble wallet cards, and polished-stone asset tiles.
// Works with live on-chain data or the labeled Demo preview.
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, RefreshCw, TrendingUp } from "lucide-react";
import { formatUsd } from "../../lib/format";
import type { Portfolio } from "../../lib/assets";
import { DEMO_CHANGE_24H, DEMO_EVM_ADDRESS, DEMO_PORTFOLIO, DEMO_SOL_ADDRESS, DEMO_SPARKLINE, DEMO_SYNTHETIC } from "../../lib/demo";
import { cfg } from "../config";
import { useWallets } from "../wallet";
import { useDemo } from "../demo";
import { usePortfolio } from "../hooks/usePortfolio";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { WalletCard } from "../components/WalletCard";
import { TokenTile } from "../components/TokenTile";
import { SculptureWidget } from "../components/SculptureWidget";
import { StarterGasBanner } from "../components/FaucetButton";
import { AllocationRing, Sparkline } from "../components/Analytics";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { Card, Eyebrow, EmptyState, Skeleton } from "../components/ui";

export function Dashboard() {
  const { evm, solana, synthetic: realSynthetic, anyConnected: walletsConnected } = useWallets();
  const { data, loading, error, refresh } = usePortfolio();
  const { demo, disable } = useDemo();

  const port: Portfolio | null = demo ? DEMO_PORTFOLIO : data;
  const evmAddr = demo ? DEMO_EVM_ADDRESS : evm.address ?? undefined;
  const solAddr = demo ? DEMO_SOL_ADDRESS : solana.publicKey?.toBase58();
  const synthetic = demo ? DEMO_SYNTHETIC : realSynthetic;
  const evmConnected = demo || Boolean(evm.address);
  const solConnected = demo || solana.connected;
  const anyConnected = demo || walletsConnected;
  const change24h = demo ? DEMO_CHANGE_24H : undefined;
  const spark = demo ? DEMO_SPARKLINE : undefined;

  // Show the "fund your wallet" nudge only for a real wallet that's low on gas.
  const gasEvm = data?.assets.find((a) => a.kind === "gas")?.evmAmount;
  const needsGas = Boolean(evm.address) && !demo && (gasEvm == null || gasEvm < 0.5);

  const allocation = (port?.assets ?? [])
    .filter((a) => (a.usdValue ?? 0) > 0)
    .map((a) => ({ symbol: a.symbol, usd: a.usdValue ?? 0, pct: port ? ((a.usdValue ?? 0) / (port.totalUsd || 1)) * 100 : 0 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Unified portfolio</Eyebrow>
          <h1 className="mt-1 font-serif text-4xl sm:text-5xl text-parchment">Portfolio</h1>
        </div>
        {anyConnected && !demo && (
          <button onClick={() => refresh()} className="btn-ghost !py-2 text-xs" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      </div>

      {!anyConnected ? (
        <ConnectPrompt />
      ) : (
        <>
          {needsGas && evm.address && <StarterGasBanner address={evm.address} onFunded={refresh} />}
          <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr] lg:items-stretch">
            <BalanceHero
              total={port?.totalUsd ?? null}
              change24h={change24h}
              spark={spark}
              loading={loading && !port}
              evmConnected={evmConnected}
              solConnected={solConnected}
              demo={demo}
            />
            <div className="hidden lg:block">
              <SculptureWidget />
            </div>
          </div>

          {/* Wallet cards */}
          <div className="grid gap-5 sm:grid-cols-2">
            <WalletCard
              variant="black"
              glyph="🦊"
              name="MetaMask"
              lane="EVM lane"
              connected={evmConnected}
              connecting={evm.connecting}
              available={demo || evm.available}
              address={evmAddr}
              installHref="https://metamask.io/download/"
              onConnect={() => evm.connect()}
              onDisconnect={() => (demo ? disable() : evm.disconnect())}
              warn={!demo && evm.address && !evm.isRome ? { label: `Switch to ${cfg.chainName}`, onClick: () => evm.switchToRome() } : undefined}
            />
            <WalletCard
              variant="rosso"
              glyph="👻"
              name="Phantom"
              lane="Solana lane"
              connected={solConnected}
              connecting={solana.connecting}
              available={demo || solana.available}
              address={solAddr}
              installHref="https://phantom.app/download"
              onConnect={() => solana.connect()}
              onDisconnect={() => (demo ? disable() : solana.disconnect())}
            />
          </div>

          {/* Analytics */}
          {port && allocation.length > 0 && (
            <Card className="hover-glow">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <Eyebrow>Allocation</Eyebrow>
                  <p className="mt-1 font-serif text-xl text-parchment">Across both lanes</p>
                </div>
                <span className="chip"><TrendingUp className="h-3.5 w-3.5" /> {port.assets.filter((a) => a.amount > 0).length} assets</span>
              </div>
              <div className="mt-5">
                <AllocationRing data={allocation} />
              </div>
            </Card>
          )}

          {/* Assets */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-2xl text-parchment">Assets</h2>
              <span className="text-xs text-parchment/40">{demo ? "Demo data" : cfg.chainName}</span>
            </div>

            {error && !demo && (
              <Card className="border-terracotta-500/30">
                <p className="text-sm text-terracotta-300">Could not read balances: {error}</p>
              </Card>
            )}

            {loading && !port ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                {cfg.tokens.map((t) => (
                  <Skeleton key={t.symbol} className="aspect-square rounded-3xl" />
                ))}
              </div>
            ) : port ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                {port.assets.map((a, i) => (
                  <TokenTile key={a.symbol} asset={a} index={i} />
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState glyph="🏺" title="No balances yet" hint="There's no faucet on Rome — bridge USDC in for gas, then it appears here." />
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BalanceHero({
  total,
  change24h,
  spark,
  loading,
  evmConnected,
  solConnected,
  demo,
}: {
  total: number | null;
  change24h?: number;
  spark?: number[];
  loading: boolean;
  evmConnected: boolean;
  solConnected: boolean;
  demo: boolean;
}) {
  const up = (change24h ?? 0) >= 0;
  return (
    <Card className="relative flex h-full flex-col overflow-hidden hover-glow !p-6 sm:!p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-champagne/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2">
          <Eyebrow>Total balance · both lanes</Eyebrow>
          {demo && <span className="chip !py-0.5 !text-[10px]">Demo</span>}
        </div>
        {loading ? (
          <Skeleton className="mt-3 h-14 w-64" />
        ) : (
          <div className="tabular mt-2 font-serif text-6xl sm:text-7xl leading-none text-parchment">
            {total == null ? "—" : <AnimatedNumber value={total} format={formatUsd} />}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {change24h != null && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${
                up ? "bg-emerald-500/15 text-emerald-300" : "bg-terracotta-500/15 text-terracotta-300"
              }`}
            >
              {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              {Math.abs(change24h).toFixed(2)}% <span className="opacity-60">24h</span>
            </span>
          )}
          {evmConnected && <span className="chip !border-indigo-300/30 !text-indigo-200">🦊 EVM</span>}
          {solConnected && <span className="chip !border-fuchsia-300/30 !text-fuchsia-200">👻 Solana</span>}
        </div>
      </div>

      {spark && (
        <div className="relative mt-auto pt-6">
          <div className="flex items-center justify-between">
            <span className="label-eyebrow">30-day trend</span>
            <span className={`text-xs ${up ? "text-emerald-300" : "text-terracotta-300"}`}>{up ? "▲" : "▼"} {Math.abs(change24h ?? 0).toFixed(2)}%</span>
          </div>
          <div className="mt-3">
            <Sparkline points={spark} height={72} />
          </div>
        </div>
      )}
    </Card>
  );
}
