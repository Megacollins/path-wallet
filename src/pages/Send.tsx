// Token send / transfer across both lanes. EVM sends any registry token; the
// Solana lane sends the gas-mint wrapper (wUSDC) — value flows through the
// synthetic, which holds nothing at rest. Every write uses the Rome SDK.
import { useMemo, useState } from "react";
import { isAddress, type Hex } from "viem";
import { parseAmountSafe } from "../../lib/format";
import type { TokenMeta } from "../../lib/assets";
import * as rome from "../../lib/rome";
import { cfg } from "../config";
import { useWallets } from "../wallet";
import { usePortfolio } from "../hooks/usePortfolio";
import { useToast } from "../components/Toast";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { Button, Card, Eyebrow, TokenGlyph } from "../components/ui";

type Lane = "evm" | "solana";

export function Send() {
  const { evm, solana, anyConnected } = useWallets();
  const toast = useToast();

  const evmReady = Boolean(evm.address) && evm.isRome;
  const [lane, setLane] = useState<Lane>("evm");
  const activeLane: Lane = lane === "evm" && !evmReady && solana.connected ? "solana" : lane;

  // Token options per lane.
  const evmTokens = cfg.tokens;
  const solTokens = useMemo(() => cfg.tokens.filter((t) => t.kind === "spl_wrapper" && t.address.toLowerCase() === cfg.wusdc.toLowerCase()), []);
  const tokens = activeLane === "evm" ? evmTokens : solTokens;

  const [symbol, setSymbol] = useState<string>("wUSDC");
  const token: TokenMeta = tokens.find((t) => t.symbol === symbol) ?? tokens[0];

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  // The connected wallet's balance of the selected token, on the active lane.
  const { data: portfolio } = usePortfolio();
  const balSymbol = activeLane === "solana" ? "wUSDC" : token?.symbol;
  const assetRow = portfolio?.assets.find((a) => a.symbol === balSymbol);
  const balance = activeLane === "evm" ? assetRow?.evmAmount ?? 0 : assetRow?.solAmount ?? 0;
  // Native gas: keep a little back so the transfer itself can pay gas.
  const isNativeGas = activeLane === "evm" && token?.kind === "gas";
  const maxAmount = isNativeGas ? Math.max(0, balance - 0.3) : balance;

  const recipientValid = isAddress(to);
  const amountBase = token ? parseAmountSafe(amount, activeLane === "solana" ? 6 : token.decimals) : null;
  const canSend =
    !busy &&
    Boolean(token) &&
    recipientValid &&
    amountBase != null &&
    amountBase > 0n &&
    (activeLane === "evm" ? evmReady : solana.connected && Boolean(solana.signTransaction));

  async function onSend() {
    if (!token || amountBase == null) return;
    setBusy(true);
    try {
      if (activeLane === "evm") {
        const provider = evm.provider!;
        const from = evm.address!;
        if (token.kind === "gas") {
          const wei = parseAmountSafe(amount, 18)!;
          await toast.run(`Send ${amount} ${token.symbol}`, () => rome.evmSendNative(provider, from, to as Hex, wei), { success: "Sent" });
        } else {
          await toast.run(`Send ${amount} ${token.symbol}`, () => rome.evmSendErc20(provider, from, token.address, to as Hex, amountBase), {
            success: "Sent",
          });
        }
      } else {
        await toast.run(`Send ${amount} wUSDC`, () => rome.solanaSendWusdc(cfg, solana.publicKey!, solana.signTransaction!, to as Hex, amountBase), {
          success: "Sent",
        });
      }
      setAmount("");
      setTo("");
    } catch {
      /* toast already surfaced the error */
    } finally {
      setBusy(false);
    }
  }

  if (!anyConnected) {
    return (
      <PageWrap>
        <ConnectPrompt title="Connect to send" hint="Send tokens from either lane. Connect the wallet you want to send from." />
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      <Card className="max-w-xl">
        {/* Lane selector */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-gold/15 bg-stone-900/60 p-1">
          <LaneTab active={activeLane === "evm"} disabled={!evm.address} onClick={() => setLane("evm")} glyph="🦊" label="MetaMask" sub="EVM" />
          <LaneTab
            active={activeLane === "solana"}
            disabled={!solana.connected}
            onClick={() => {
              setLane("solana");
              setSymbol("wUSDC");
            }}
            glyph="👻"
            label="Phantom"
            sub="Solana"
          />
        </div>

        {activeLane === "evm" && evm.address && !evm.isRome && (
          <div className="mb-4 rounded-xl border border-terracotta-500/40 bg-terracotta-500/10 p-3 text-sm text-terracotta-300">
            MetaMask is on the wrong network.{" "}
            <button onClick={() => evm.switchToRome()} className="underline">
              Switch to {cfg.chainName}
            </button>
          </div>
        )}

        {/* Token */}
        <label className="label-eyebrow">Asset</label>
        <div className="mt-2 mb-4 flex flex-wrap gap-2">
          {tokens.map((t) => (
            <button
              key={t.symbol}
              onClick={() => setSymbol(t.symbol)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                token?.symbol === t.symbol ? "border-gold/60 bg-stone-800/70 text-parchment" : "border-gold/15 text-parchment/60 hover:border-gold/30"
              }`}
            >
              <TokenGlyph symbol={t.symbol} size={24} />
              {t.symbol}
            </button>
          ))}
        </div>

        {/* Recipient */}
        <label className="label-eyebrow">Recipient (Rome EVM address)</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" className="input-stone mt-2 font-mono text-sm" spellCheck={false} />
        {to && !recipientValid && <p className="mt-1 text-xs text-terracotta-300">Enter a valid 0x address.</p>}

        {/* Amount */}
        <div className="mt-4 flex items-baseline justify-between">
          <label className="label-eyebrow">Amount</label>
          {(evm.address || solana.connected) && (
            <span className="text-xs text-parchment/50">
              Balance: <span className="tabular text-parchment/80">{balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span> {balSymbol}
              <button onClick={() => setAmount(String(maxAmount))} disabled={busy || maxAmount <= 0} className="ml-2 text-champagne-200 hover:text-champagne-100 disabled:opacity-40">
                Max
              </button>
            </span>
          )}
        </div>
        <div className="relative mt-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            className="input-stone pr-20 text-lg"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-parchment/50">{activeLane === "solana" ? "wUSDC" : token?.symbol}</span>
        </div>

        <Button className="mt-6 w-full" onClick={onSend} loading={busy} disabled={!canSend}>
          {busy ? "Sending…" : `Send ${activeLane === "solana" ? "wUSDC" : token?.symbol ?? ""}`}
        </Button>

        <p className="mt-3 text-[11px] leading-relaxed text-parchment/40">
          {activeLane === "evm"
            ? "Signed by MetaMask and submitted via submitRomeTx. Native sends cost ~1.48M gas on Rome."
            : "Signed by Phantom and submitted via submitRomeTxSolanaLane. wUSDC is funded into your synthetic, then transferred."}
        </p>
      </Card>
    </PageWrap>
  );
}

function PageWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Transfer</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">Send</h1>
      </div>
      {children}
    </div>
  );
}

function LaneTab({
  active,
  disabled,
  onClick,
  glyph,
  label,
  sub,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  glyph: string;
  label: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm transition ${
        active ? "bg-gold-sheen text-stone-950 font-medium shadow-gold" : "text-parchment/60 hover:text-parchment disabled:opacity-30"
      }`}
    >
      <span>{glyph}</span>
      <span>{label}</span>
      <span className={`text-[10px] uppercase tracking-widest ${active ? "text-stone-900/70" : "text-parchment/30"}`}>{sub}</span>
    </button>
  );
}
