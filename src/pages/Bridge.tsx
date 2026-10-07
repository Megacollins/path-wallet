// "Bridge USDC in" — brings USDC from a testnet source chain into Rome as gas,
// via the official Rome bridge (SDK + rome-bridge-api). Needs VITE_BRIDGE_API_URL
// set to a hosted rome-bridge-api endpoint; degrades to a helpful notice otherwise.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ExternalLink, Spline } from "lucide-react";
import type { Hex } from "viem";
import { parseAmountSafe } from "../../lib/format";
import { readAccountStatus, readErc20Human } from "../../lib/assets";
import {
  bridgeUsdcIn,
  burnWasRelayed,
  clearPendingBurn,
  getBridgeQuote,
  loadPendingBurns,
  markPendingBlocked,
  resumeBridge,
  type BridgePhase,
  type PendingBurn,
  type QuotePreview,
} from "../../lib/bridge";
import { cfg } from "../config";
import { useWallets } from "../wallet";
import { useToast } from "../components/Toast";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { Button, Card, Eyebrow, Spinner } from "../components/ui";

// Rome's hosted bridge-api (the devnet default the `rome` CLI uses). The SDK
// appends `/v1/...`, so the base must be the ROOT (no trailing /v1) — we
// defensively strip any accidental trailing /v1 or slash.
//
// The hosted API no longer sends CORS headers, so a browser can't call it from
// our origin directly (every call dies as "Failed to fetch"). We reach it through
// a SAME-ORIGIN proxy instead: `/bridge-api/*` is rewritten to the hosted API by
// vercel.json in production and by the Vite dev/preview proxy locally. A custom
// VITE_BRIDGE_API_URL (e.g. a self-hosted API with CORS enabled) is used as-is.
const HOSTED_DEVNET_BRIDGE_API = "https://bridge-api.devnet.romeprotocol.xyz";
const BRIDGE_PROXY_BASE = "/bridge-api";
const envBridgeBase = ((import.meta.env.VITE_BRIDGE_API_URL as string | undefined)?.trim() ?? "").replace(/\/(v1)?\/?$/, "");
const BRIDGE_API = !envBridgeBase || envBridgeBase === HOSTED_DEVNET_BRIDGE_API ? BRIDGE_PROXY_BASE : envBridgeBase;

const PHASE_LABEL: Record<string, string> = {
  quoting: "Getting a quote…",
  "switch-network": "Switch your wallet to the source chain…",
  signing: "Approve & burn USDC in your wallet…",
  "confirming-source": "Confirming on the source chain…",
  authorizing: "Sign the Rome settle authorization…",
  registering: "Registering the transfer…",
  registered: "Registered — waiting on the network…",
  "awaiting-attestation": "Waiting for Circle's attestation — ~15–20 min for standard CCTP. Keep this tab open…",
  "awaiting-vaa": "Waiting for the attestation — this can take several minutes…",
  submitting: "Settling on Rome…",
  complete: "Done — USDC landed on Rome.",
  failed: "The bridge failed.",
};

export function Bridge() {
  const { evm } = useWallets();
  const toast = useToast();
  const sources = cfg.bridgeSources ?? [];

  const [sourceId, setSourceId] = useState<number>(sources[0]?.chainId ?? 0);
  const [amount, setAmount] = useState("2");
  const [speed, setSpeed] = useState<"standard" | "fast">("standard");
  const [phase, setPhase] = useState<BridgePhase | null>(null);
  const [busy, setBusy] = useState(false);

  const source = useMemo(() => sources.find((s) => s.chainId === sourceId) ?? sources[0], [sources, sourceId]);
  const amount6 = parseAmountSafe(amount, 6);
  const configured = BRIDGE_API.length > 0;
  // Pre-flight on the chosen source chain, BEFORE anything is signed: a smart account
  // (relayed txs the bridge rejects) or an empty gas balance would burn/stall USDC.
  const [acct, setAcct] = useState<Awaited<ReturnType<typeof readAccountStatus>> | null>(null);
  useEffect(() => {
    setAcct(null);
    if (!evm.address || !source) return;
    let cancelled = false;
    readAccountStatus(source.rpcUrl, evm.address as Hex).then((a) => {
      if (!cancelled) setAcct(a);
    });
    return () => {
      cancelled = true;
    };
  }, [evm.address, source, busy]);
  const smartAccount = acct?.hasCode === true;
  const noGas = acct?.nativeWei === 0n;
  const canBridge = configured && !busy && Boolean(evm.address) && Boolean(source) && amount6 != null && amount6 > 0n && !smartAccount && !noGas;

  // The connected wallet's USDC balance on the selected source chain.
  const [srcBalance, setSrcBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!evm.address || !source?.usdc) {
      setSrcBalance(null);
      return;
    }
    let cancelled = false;
    setSrcBalance(null);
    readErc20Human(source.rpcUrl, source.usdc, evm.address as Hex, 6).then((b) => {
      if (!cancelled) setSrcBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [evm.address, sourceId, source]);

  // Live quote preview — re-fetched (debounced) whenever the inputs change.
  const [quote, setQuote] = useState<QuotePreview | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  useEffect(() => {
    if (!configured || busy || !evm.address || !source || amount6 == null || amount6 <= 0n) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setQuoteErr(null);
    const t = setTimeout(async () => {
      try {
        const q = await getBridgeQuote({ cfg, apiBase: BRIDGE_API, source, evmAddress: evm.address as Hex, amount6, speed });
        if (!cancelled) setQuote(q);
      } catch (e: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteErr(e?.detail || e?.message || "Couldn't fetch a quote for this route.");
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, busy, evm.address, sourceId, amount, speed]);

  // Burns that happened but were never registered (failure / closed tab) — finishable.
  const [pending, setPending] = useState<PendingBurn[]>([]);
  const [recoverHash, setRecoverHash] = useState("");
  const [recoverOpen, setRecoverOpen] = useState(false);
  const refreshPending = () => setPending(evm.address ? loadPendingBurns(evm.address) : []);
  useEffect(refreshPending, [evm.address, busy]);

  // A saved burn that a relayer sent (smart-account wallet) can never be registered —
  // spot it up front so we don't offer a Finish button that is certain to fail.
  const checkedBurns = useRef(new Set<string>());
  useEffect(() => {
    for (const p of pending) {
      if (p.blocked || checkedBurns.current.has(p.burnHash)) continue;
      checkedBurns.current.add(p.burnHash);
      const src = sources.find((s) => s.chainId === p.sourceChainId);
      if (!src) continue;
      void burnWasRelayed(src.rpcUrl, p.burnHash, p.address).then((relayed) => {
        if (relayed === true) {
          markPendingBlocked(p.burnHash);
          refreshPending();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const recoverHashValid = /^0x[0-9a-fA-F]{64}$/.test(recoverHash.trim());

  /** Shared runner: busy state, live phase, success/failure toasts. */
  async function execute(flow: () => Promise<{ id: string; landed: boolean }>, usdc: string) {
    setBusy(true);
    setPhase({ phase: "quoting" });
    try {
      const res = await flow();
      if (res.landed) {
        toast.push({ kind: "success", title: "Bridged into Rome", message: `${usdc} USDC is now available as gas.` });
        await evm.switchToRome().catch(() => {});
      } else {
        toast.push({ kind: "info", title: "Still settling", message: "The bridge is finishing — your USDC will arrive shortly." });
      }
    } catch (e: any) {
      // Surface the real cause (SDK BridgeApiError carries status/code/detail).
      let detail = [e?.status ? `HTTP ${e.status}` : "", e?.code, e?.detail || e?.shortMessage || e?.message || String(e)].filter(Boolean).join(" · ");
      console.error("[bridge] failed:", e);
      if (e?.burnHash) {
        // Failed after the burn confirmed: the USDC is already burned — point at recovery.
        setRecoverHash(e.burnHash);
        if (e?.code === "rome.bridge.source-tx-mismatch") {
          // burner != tx sender: the wallet relayed the burn through a smart account (EIP-7702 / contract wallet).
          // "Finish" can't fix this (the bridge re-checks the same transaction) — don't point at it.
          detail += ` — your wallet sent the burn through a smart account, which the bridge can't verify. The USDC is burned, not lost: Circle's attestation is public and anyone can mint it, but the bridge won't register this transaction. Keep the burn tx hash (${e.burnHash}) and ask Rome to settle it; switch this account back to a standard account before bridging again.`;
        } else {
          setRecoverOpen(true);
          detail += ` — the transfer wasn't registered. If your USDC was already burned on the source chain, nothing is lost: use "Finish a bridge" below to complete it (burn tx ${e.burnHash.slice(0, 10)}…).`;
        }
      }
      toast.push({ kind: "error", title: "Bridge failed", message: detail });
      setPhase({ phase: "failed", detail });
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!source || amount6 == null || !evm.provider || !evm.address) return;
    const provider = evm.provider;
    const evmAddress = evm.address as Hex;
    await execute(() => bridgeUsdcIn({ cfg, apiBase: BRIDGE_API, provider, source, evmAddress, amount6, speed, onPhase: setPhase }), amount);
  }

  /** Finish a burned-but-unregistered transfer: from a saved record, or a pasted burn tx hash + the selected chain/amount. */
  async function finish(p: { burnHash: string; sourceChainId: number; amount6: bigint; speed: "standard" | "fast" }) {
    const src = sources.find((s) => s.chainId === p.sourceChainId);
    if (!src || !evm.provider || !evm.address) return;
    const provider = evm.provider;
    const evmAddress = evm.address as Hex;
    await execute(
      () => resumeBridge({ cfg, apiBase: BRIDGE_API, provider, source: src, evmAddress, amount6: p.amount6, speed: p.speed, burnHash: p.burnHash, onPhase: setPhase }),
      (Number(p.amount6) / 1e6).toLocaleString(),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Fund your wallet</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">Bridge USDC in</h1>
        <p className="mt-1 max-w-2xl text-sm text-parchment/55">
          Rome has no faucet — gas is USDC. Bring some in from a testnet you already have funds on. You sign everything in your own wallet.
        </p>
      </div>

      {!evm.address ? (
        <ConnectPrompt title="Connect MetaMask to bridge" hint="Bridging moves USDC from a source chain into Rome — connect the EVM wallet holding your source-chain USDC." showDemo={false} />
      ) : !configured ? (
        <Card className="border-champagne/20">
          <Eyebrow>Bridge not configured</Eyebrow>
          <p className="mt-2 text-sm text-parchment/70">
            Set <code className="text-gold-200">VITE_BRIDGE_API_URL</code> to a hosted{" "}
            <a className="text-gold-200 hover:underline" href="https://github.com/rome-protocol/rome-bridge-api" target="_blank" rel="noreferrer">rome-bridge-api</a>{" "}
            endpoint (Rome's, or self-hosted), then rebuild. Until then, bridge manually:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-gold/15 bg-stone-950/60 p-3 text-xs text-parchment/80">rome fund {cfg.chainName.toLowerCase().replace("rome ", "")} --from sepolia --amount 2</pre>
          <a href="https://docs.rome.builders" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-champagne-200/80 hover:text-champagne-100">
            Bridge docs <ExternalLink className="h-3 w-3" />
          </a>
        </Card>
      ) : (
        <>
        {/* A burn that was never registered — the USDC is in the air until this is finished. */}
        {pending.map((p) => {
          const src = sources.find((s) => s.chainId === p.sourceChainId);
          const usdc = (Number(p.amount6) / 1e6).toLocaleString();
          if (p.blocked) {
            // Sent by a relayer: the bridge will never register it, so no Finish button — only Rome can settle it.
            return (
              <Card key={p.burnHash} className="max-w-xl border-terracotta-500/40">
                <Eyebrow>Burned — needs Rome to settle</Eyebrow>
                <p className="mt-2 text-sm text-parchment/80">
                  {usdc} USDC from {src?.name ?? `chain ${p.sourceChainId}`} was burned, but your wallet sent it through a smart account (a relayer, not your own address), and the
                  bridge only registers burns sent directly by their owner — so <span className="text-parchment">Finish can't work for this one</span>. The USDC isn't lost: Circle has
                  attested the burn and it can be minted to you. Send Rome this burn tx hash and ask them to settle it.
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-parchment/40">burn tx {p.burnHash}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(p.burnHash);
                      toast.push({ kind: "success", title: "Copied", message: "Burn transaction hash copied." });
                    }}
                  >
                    Copy burn tx hash
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      clearPendingBurn(p.burnHash);
                      refreshPending();
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              </Card>
            );
          }
          return (
            <Card key={p.burnHash} className="max-w-xl border-champagne/40">
              <Eyebrow>Unfinished bridge</Eyebrow>
              <p className="mt-2 text-sm text-parchment/80">
                {(Number(p.amount6) / 1e6).toLocaleString()} USDC from {src?.name ?? `chain ${p.sourceChainId}`} was burned, but the transfer was never registered with the bridge.
                Nothing is lost — finish it now (you'll sign one free message; no new burn, no gas).
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-parchment/40">burn tx {p.burnHash}</p>
              <Button
                className="mt-4 w-full sm:w-auto"
                loading={busy}
                disabled={busy || !src}
                onClick={() => finish({ burnHash: p.burnHash, sourceChainId: p.sourceChainId, amount6: BigInt(p.amount6), speed: p.speed })}
              >
                Finish this bridge
              </Button>
            </Card>
          );
        })}
        <Card className="max-w-xl">
          <label className="label-eyebrow">From</label>
          <div className="mt-2 mb-4 flex flex-wrap gap-2">
            {sources.map((s) => (
              <button
                key={s.chainId}
                onClick={() => setSourceId(s.chainId)}
                disabled={busy}
                className={`rounded-xl border px-3 py-2 text-sm transition ${
                  source?.chainId === s.chainId ? "border-gold/60 bg-stone-800/70 text-parchment" : "border-gold/15 text-parchment/60 hover:border-gold/30"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>

          {smartAccount && (
            <div className="mb-4 rounded-xl border border-terracotta-500/40 bg-terracotta-500/10 p-3 text-sm text-terracotta-300" role="alert">
              <p className="font-medium">Your account is a smart account on {source?.name}.</p>
              <p className="mt-1 text-terracotta-300/90">
                MetaMask upgraded it (EIP-7702), so it sends transactions through a relayer. Rome's bridge can't tie a relayed burn to your signature and rejects it — the USDC
                would be burned but never credited. Bridge from another chain, or in MetaMask switch this account back to a standard account for {source?.name} (the menu
                wording varies by version — look under the account's details / smart-account settings), then reload this page.
              </p>
            </div>
          )}
          {noGas && !smartAccount && (
            <div className="mb-4 rounded-xl border border-terracotta-500/40 bg-terracotta-500/10 p-3 text-sm text-terracotta-300" role="alert">
              You have no {source?.nativeSymbol ?? "gas token"} on {source?.name} to pay for the burn transaction. Get some from that chain's own faucet first (USDC alone isn't enough).
            </div>
          )}

          <div className="flex items-center gap-3 rounded-2xl border border-champagne/15 bg-stone-900/40 p-4">
            <div className="flex-1">
              <div className="text-xs text-parchment/50">{source?.name}</div>
              <div className="font-medium text-parchment">USDC</div>
            </div>
            <ArrowRight className="h-4 w-4 text-champagne/70" />
            <div className="flex-1 text-right">
              <div className="text-xs text-parchment/50">{cfg.chainName}</div>
              <div className="font-medium text-parchment">USDC gas</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <label className="label-eyebrow">Amount (USDC)</label>
            {srcBalance != null && (
              <span className="text-xs text-parchment/50">
                Balance: <span className="tabular text-parchment/80">{srcBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                <button onClick={() => setAmount(String(srcBalance))} disabled={busy || srcBalance <= 0} className="-my-1.5 ml-1 px-1.5 py-1.5 text-champagne-200 hover:text-champagne-100 disabled:opacity-40">
                  Max
                </button>
              </span>
            )}
          </div>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="input-stone mt-2 text-lg" placeholder="2" disabled={busy} />

          {/* Speed: standard (waits for finality, free) vs fast (seconds, small fee) */}
          <label className="label-eyebrow mt-4 block">Speed</label>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-2xl border border-champagne/15 bg-stone-900/60 p-1">
            {([
              { id: "standard", label: "Standard", sub: "~15–20 min · free" },
              { id: "fast", label: "Fast", sub: "seconds · small fee" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSpeed(opt.id)}
                disabled={busy}
                className={`flex flex-col items-center rounded-xl py-2 text-sm transition ${
                  speed === opt.id ? "bg-gold-sheen text-stone-950 font-medium shadow-gold" : "text-parchment/60 hover:text-parchment disabled:opacity-40"
                }`}
              >
                <span>{opt.label}</span>
                <span className={`text-[10px] ${speed === opt.id ? "text-stone-900/70" : "text-parchment/40"}`}>{opt.sub}</span>
              </button>
            ))}
          </div>

          {/* Live quote */}
          {!busy && (quoting || quote || quoteErr) && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl border border-champagne/15 bg-stone-900/40 p-4 text-sm">
              {quoting ? (
                <div className="flex items-center gap-2 text-parchment/60"><Spinner className="text-gold" /> Fetching live quote…</div>
              ) : quoteErr ? (
                <div className="text-terracotta-300">{quoteErr}</div>
              ) : quote ? (
                <dl className="space-y-2">
                  <QuoteRow label="You send" value={`${quote.amountIn.toLocaleString()} USDC`} />
                  <QuoteRow label="You receive" value={`${quote.amountOut.toLocaleString()} USDC gas`} strong />
                  <QuoteRow
                    label="Bridge fee"
                    value={(() => {
                      const implied = Math.max(0, quote.amountIn - quote.amountOut);
                      const fee = quote.feeUsdc > 0 ? quote.feeUsdc : implied;
                      return fee > 0 ? `${fee.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC${quote.feeBps ? ` · ${quote.feeBps} bps` : ""}` : "Free";
                    })()}
                  />
                  <QuoteRow label="Est. arrival" value={fmtEta(quote.etaSeconds)} />
                </dl>
              ) : null}
            </motion.div>
          )}

          <Button className="mt-5 w-full" onClick={run} loading={busy} disabled={!canBridge}>
            <Spline className="h-4 w-4" /> {busy ? "Bridging…" : `Bridge from ${source?.name ?? ""}`}
          </Button>

          {phase && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-center gap-3 rounded-xl border border-gold/15 bg-stone-900/50 p-3">
              {busy && phase.phase !== "complete" ? <Spinner className="text-gold" /> : <span className="text-emerald-300">✓</span>}
              <div className="text-sm text-parchment/80">
                {PHASE_LABEL[phase.phase] ?? phase.phase}
                {phase.detail && <span className="text-parchment/45"> · {phase.detail}</span>}
              </div>
            </motion.div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-parchment/40">
            Uses Circle CCTP via Rome's bridge. The attestation step takes a few minutes — keep this tab open. Get testnet USDC on the source chain from its faucet first.
          </p>
        </Card>

        {/* Manual recovery — for a burn that failed before it was remembered (or in another browser). */}
        <div className="max-w-xl">
          <button onClick={() => setRecoverOpen((v) => !v)} className="text-xs text-parchment/50 underline decoration-parchment/20 underline-offset-4 hover:text-parchment/80" aria-expanded={recoverOpen}>
            Bridge failed after you signed? Finish a bridge
          </button>
          {recoverOpen && (
            <Card className="mt-3">
              <p className="text-sm text-parchment/70">
                If your wallet already burned USDC on the source chain but the bridge then errored, paste that <span className="text-parchment">burn transaction hash</span> (MetaMask → Activity →
                the “Deposit for burn” transaction). Set the source chain and amount above to match that transfer, then finish it — nothing is burned or spent again.
              </p>
              <input
                value={recoverHash}
                onChange={(e) => setRecoverHash(e.target.value)}
                placeholder="0x… burn transaction hash"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={busy}
                className="input-stone mt-3 font-mono text-base sm:text-sm"
              />
              {recoverHash && !recoverHashValid && <p className="mt-1 text-xs text-terracotta-300">That doesn't look like a transaction hash (0x + 64 hex characters).</p>}
              <p className="mt-2 text-[11px] text-parchment/40">
                Will finish: {amount || "—"} USDC from {source?.name ?? "—"} ({speed}).
              </p>
              <Button
                className="mt-3 w-full sm:w-auto"
                loading={busy}
                disabled={busy || !recoverHashValid || !source || amount6 == null || amount6 <= 0n}
                onClick={() => source && amount6 != null && finish({ burnHash: recoverHash.trim(), sourceChainId: source.chainId, amount6, speed })}
              >
                Finish this bridge
              </Button>
            </Card>
          )}
        </div>
        </>
      )}
    </div>
  );
}

function QuoteRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-parchment/50">{label}</dt>
      <dd className={`tabular text-right ${strong ? "font-medium text-champagne-100" : "text-parchment/85"}`}>{value}</dd>
    </div>
  );
}

function fmtEta(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 90) return `~${Math.round(seconds)}s`;
  return `~${Math.round(seconds / 60)} min`;
}
