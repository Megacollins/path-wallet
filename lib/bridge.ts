// In-app "Bridge USDC in" flow (source testnet → Rome), driving the official
// @rome-protocol/sdk/bridge client. Inbound CCTP gas route:
//   quote → switch wallet to source chain → sign approve+burn → sign the EIP-712
//   settle authorization → registerTransfer → poll until USDC lands on Rome.
// Needs a hosted rome-bridge-api base URL (VITE_BRIDGE_API_URL). The user signs
// everything in their own wallet; Path never holds their keys.
import {
  requestQuote,
  inboundCctpQuoteRequest,
  userSignedTxs,
  step1BindingTxIndex,
  settleTypedDataWithBurn,
  registerTransfer,
  getTransfer,
  transferFlowStatus,
  BridgeApiError,
  type Quote,
  type TransferRecord,
} from "@rome-protocol/sdk/bridge";
import { createPublicClient, http, type Hex } from "viem";
import type { BridgeSource, PathConfig } from "./assets.js";

type Eip1193 = { request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown> };

/**
 * Register the transfer once the source burn is on-chain.
 *
 * The hosted bridge-api now REJECTS the full client-supplied quote that the SDK's
 * `registerTransfer` sends ("client-supplied quote is disabled on this deployment —
 * obtain a quoteId from POST /v1/quote") and wants `{ quoteId, step1TxHash,
 * userSettleSig }` instead. Quotes that carry a quoteId are registered that way;
 * older / self-hosted deployments that don't return one still go through the SDK.
 */
async function registerTransferCompat(
  p: { quote: Quote; step1TxHash: string; userSettleSig?: string },
  api: { base: string },
): Promise<TransferRecord> {
  const quoteId = (p.quote as { quoteId?: unknown }).quoteId;
  if (typeof quoteId !== "string" || !quoteId) return registerTransfer(p, api);
  const res = await fetch(`${api.base}/v1/transfers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ quoteId, step1TxHash: p.step1TxHash, ...(p.userSettleSig ? { userSettleSig: p.userSettleSig } : {}) }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new BridgeApiError({ code: body?.code ?? "rome.bridge.unknown", status: res.status, title: body?.title, detail: body?.detail ?? `HTTP ${res.status}` });
  }
  return body as TransferRecord;
}

/* ------------------------------------------------- burns that need finishing */

/**
 * A burn that has happened on the source chain but whose transfer isn't registered
 * with the bridge yet. Between the burn confirming and registration succeeding the
 * user's USDC is "in the air" — so it's saved the moment the burn confirms, and can
 * be finished (re-quote → re-sign → register) after a failure or a closed tab.
 */
export interface PendingBurn {
  burnHash: string;
  sourceChainId: number;
  /** 6-dec USDC base units, as a decimal string. */
  amount6: string;
  speed: "standard" | "fast";
  address: string;
  ts: number;
  /**
   * The Rome chain this burn was bridging INTO. A resume must register against the same chain even if
   * the user has since switched networks. Absent on burns saved before the network switcher existed —
   * those were all Rome Hadrian, the default chain.
   */
  romeChainId?: number;
  /**
   * Set when the burn was sent by a relayer (a smart-account / EIP-7702 wallet): the
   * bridge only registers burns whose sender IS the burning account, so "Finish" can
   * never work for it — only Rome can settle it.
   */
  blocked?: boolean;
}

const PENDING_KEY = "path.pendingBridge.v1";

function readPending(): PendingBurn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function writePending(list: PendingBurn[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode) — recovery by pasting the hash still works */
  }
}
export function loadPendingBurns(address: string): PendingBurn[] {
  return readPending().filter((p) => p.address.toLowerCase() === address.toLowerCase());
}
export function savePendingBurn(p: PendingBurn) {
  writePending([...readPending().filter((x) => x.burnHash !== p.burnHash), p]);
}
export function clearPendingBurn(burnHash: string) {
  writePending(readPending().filter((x) => x.burnHash !== burnHash));
}
export function markPendingBlocked(burnHash: string) {
  writePending(readPending().map((x) => (x.burnHash === burnHash ? { ...x, blocked: true } : x)));
}

/**
 * Was this burn transaction sent by someone other than `account`? That is what a
 * wallet-relayed smart-account (EIP-7702) transaction looks like — the burn event's
 * depositor is the account, but tx.from is the relayer — and the bridge rejects it
 * (`source-tx-mismatch`). null = couldn't tell (RPC trouble): callers must not block on it.
 */
export async function burnWasRelayed(rpcUrl: string, burnHash: string, account: string): Promise<boolean | null> {
  try {
    const tx = await createPublicClient({ transport: http(rpcUrl) }).getTransaction({ hash: burnHash as Hex });
    return tx.from.toLowerCase() !== account.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Raised for a failure AFTER the burn confirmed but BEFORE the transfer was
 * registered: the USDC is already burned, so the caller must point the user at
 * recovery with `burnHash`. Copies the API error fields so existing error
 * formatting (`status` / `code` / `detail`) keeps working.
 */
export class BridgeAfterBurnError extends Error {
  readonly burnHash: string;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  constructor(cause: any, burnHash: string) {
    super(cause?.detail || cause?.shortMessage || cause?.message || String(cause));
    this.name = "BridgeAfterBurnError";
    this.burnHash = burnHash;
    this.status = cause?.status;
    this.code = cause?.code;
    this.detail = cause?.detail;
  }
}

export interface BridgePhase {
  phase: string;
  detail?: string;
  txHash?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toHexQty = (v?: string) => (v && v !== "0" ? `0x${BigInt(v).toString(16)}` : undefined);
const toUsdc = (v?: string) => (v ? Number(BigInt(v)) / 1e6 : 0);

export interface QuotePreview {
  amountIn: number;
  amountOut: number;
  feeUsdc: number;
  feeBps: number;
  etaSeconds?: number;
  route: string;
}

/** Fetch a quote for display only (no signing, no execution). */
export async function getBridgeQuote(opts: {
  cfg: PathConfig;
  apiBase: string;
  source: BridgeSource;
  evmAddress: Hex;
  amount6: bigint;
  speed?: "standard" | "fast";
}): Promise<QuotePreview> {
  const api = { base: opts.apiBase.replace(/\/$/, "") };
  const q = await requestQuote(
    inboundCctpQuoteRequest({ sourceChainId: opts.source.chainId, romeChainId: opts.cfg.chainId, amount: opts.amount6, evmAddress: opts.evmAddress, speed: opts.speed ?? "standard" }),
    api,
  );
  return { amountIn: toUsdc(q.amountIn), amountOut: toUsdc(q.amountOut), feeUsdc: toUsdc(q.fee?.absolute), feeBps: q.fee?.bps ?? 0, etaSeconds: q.etaSeconds, route: q.route };
}

/** Ensure the wallet is on `source` (add the chain if unknown). */
export async function ensureSourceChain(provider: Eip1193, source: BridgeSource) {
  const hexId = `0x${source.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err: any) {
    if (err?.code === 4902 || /unrecognized|not been added/i.test(err?.message ?? "")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId,
          chainName: source.name,
          nativeCurrency: { name: source.nativeSymbol ?? "ETH", symbol: source.nativeSymbol ?? "ETH", decimals: 18 },
          rpcUrls: [source.rpcUrl],
          blockExplorerUrls: source.explorerUrl ? [source.explorerUrl] : [],
        }],
      });
    } else {
      throw err;
    }
  }

  // Confirm the wallet is REALLY on the source chain. `wallet_addEthereumChain`
  // can resolve before the user approves MetaMask's follow-up "switch network"
  // prompt; carrying on then sends the approve/burn to whatever chain the wallet
  // is still on (e.g. Rome). Only Sepolia is built into MetaMask, so every other
  // source chain goes through this add-then-switch path.
  const deadline = Date.now() + 25_000;
  for (;;) {
    const current = parseInt((await provider.request({ method: "eth_chainId" })) as string, 16);
    if (current === source.chainId) return;
    if (Date.now() > deadline) {
      throw new Error(`Your wallet is still on chain ${current}. Switch it to ${source.name} (chain ${source.chainId}) in MetaMask, then try again.`);
    }
    await sleep(1000);
  }
}

/** A node refusing a tx because its fee cap is below the current base fee ("max fee per gas less than block base fee"). */
function isFeeTooLow(e: unknown): boolean {
  const x = e as { message?: string; data?: { message?: string } };
  return /max fee per gas less than (the )?block base fee|fee cap less than block base fee|maxFeePerGas.*baseFee|transaction underpriced|gas price below/i.test(`${x?.message ?? ""} ${x?.data?.message ?? ""}`);
}

/**
 * Send a source-chain tx. If the node rejects the wallet's fee as below the current
 * base fee, resend ONCE with an explicit, buffered fee. This happens for real on
 * fast-moving chains: on Arbitrum Sepolia the base fee swings ~1.5% block to block and
 * MetaMask priced a burn at 89,484,000 wei against a 89,910,000 base fee. A tx rejected
 * at submission never reaches the mempool, so nothing was sent and resending can't
 * double-send. The buffer (2× base fee) costs next to nothing on these chains.
 */
async function sendWithFeeRetry(provider: Eip1193, tx: { from: string; to: string; data: string; value?: string }): Promise<string> {
  try {
    return (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  } catch (e) {
    if (!isFeeTooLow(e)) throw e;
    const block = (await provider.request({ method: "eth_getBlockByNumber", params: ["latest", false] }).catch(() => null)) as { baseFeePerGas?: string } | null;
    const base = BigInt(block?.baseFeePerGas ?? ((await provider.request({ method: "eth_gasPrice" })) as string));
    let tip = 0n;
    try {
      tip = BigInt((await provider.request({ method: "eth_maxPriorityFeePerGas" })) as string);
    } catch {
      /* chain doesn't expose it — a zero tip is valid on these L2s */
    }
    const maxFeePerGas = base * 2n + tip;
    const hex = (n: bigint) => `0x${n.toString(16)}`;
    return (await provider.request({ method: "eth_sendTransaction", params: [{ ...tx, maxFeePerGas: hex(maxFeePerGas), maxPriorityFeePerGas: hex(tip) }] })) as string;
  }
}

async function waitReceipt(provider: Eip1193, hash: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (r) {
      if (r.status && r.status !== "0x1") throw new Error("Source transaction reverted");
      return;
    }
    await sleep(3000);
  }
  throw new Error("Timed out waiting for the source transaction to confirm");
}

/**
 * Bridge `amount6` (6-dec USDC base units) from `source` into Rome as gas.
 * Returns once landed, or when the poll window elapses (still settling).
 */
export async function bridgeUsdcIn(opts: {
  cfg: PathConfig;
  apiBase: string;
  provider: Eip1193;
  source: BridgeSource;
  evmAddress: Hex;
  amount6: bigint;
  speed?: "standard" | "fast";
  onPhase?: (p: BridgePhase) => void;
}): Promise<{ id: string; landed: boolean }> {
  const { cfg, apiBase, provider, source, evmAddress, amount6, speed = "standard", onPhase } = opts;
  const api = { base: apiBase.replace(/\/$/, "") };
  const say = (phase: string, extra?: Partial<BridgePhase>) => onPhase?.({ phase, ...extra });

  // 1) quote
  say("quoting");
  const quote = await requestQuote(inboundCctpQuoteRequest({ sourceChainId: source.chainId, romeChainId: cfg.chainId, amount: amount6, evmAddress, speed }), api);

  // 2) put the wallet on the source chain
  say("switch-network", { detail: source.name });
  await ensureSourceChain(provider, source);

  // 3) sign the user's source-chain txs (approve + depositForBurn)
  const txs = userSignedTxs(quote, quote.route);
  const burnIdx = step1BindingTxIndex(txs);
  let burnHash = "";
  for (let i = 0; i < txs.length; i++) {
    const { tx } = txs[i];
    say("signing", { detail: tx.description || `Approve & burn (${i + 1}/${txs.length})` });
    const hash = await sendWithFeeRetry(provider, { from: evmAddress, to: tx.to, data: tx.data, value: toHexQty(tx.value) });
    say("confirming-source", { txHash: hash });
    await waitReceipt(provider, hash);
    if (i === burnIdx) burnHash = hash;
  }
  if (!burnHash) throw new Error("Could not identify the burn transaction");

  // The USDC is now burned. Remember it until registration succeeds, so a failure
  // (or a closed tab) from here on can be finished instead of stranding the funds.
  savePendingBurn({ burnHash, sourceChainId: source.chainId, amount6: amount6.toString(), speed, address: evmAddress, ts: Date.now(), romeChainId: cfg.chainId });

  return finishFromBurn({ api, provider, evmAddress, quote, burnHash, say });
}

/**
 * Steps 4–5, shared by a fresh bridge and a resume: sign the settle authorization
 * for this burn, register the transfer, then poll to completion.
 */
async function finishFromBurn(p: {
  api: { base: string };
  provider: Eip1193;
  evmAddress: Hex;
  quote: Quote;
  burnHash: string;
  say: (phase: string, extra?: Partial<BridgePhase>) => void;
}): Promise<{ id: string; landed: boolean }> {
  const { api, provider, evmAddress, quote, burnHash, say } = p;
  let rec: TransferRecord;
  try {
    // 4) sign the trustless settle authorization (gas-intent CCTP inbound)
    let userSettleSig: string | undefined;
    const typed = settleTypedDataWithBurn(quote, burnHash);
    if (typed) {
      say("authorizing");
      userSettleSig = (await provider.request({ method: "eth_signTypedData_v4", params: [evmAddress, JSON.stringify(typed)] })) as string;
    }
    // 5) register with the bridge
    say("registering");
    rec = await registerTransferCompat({ quote, step1TxHash: burnHash, userSettleSig }, api);
  } catch (e) {
    // burn is confirmed but not registered — the caller must offer recovery
    if ((e as { code?: string })?.code === "rome.bridge.source-tx-mismatch") markPendingBlocked(burnHash); // Finish can't fix this one
    throw new BridgeAfterBurnError(e, burnHash);
  }
  clearPendingBurn(burnHash); // registered: the bridge owns it from here

  // Standard CCTP waits on source-chain finality (~13–19 min for Sepolia), so
  // poll well past that; the transfer still completes on Rome's side regardless.
  const deadline = Date.now() + 28 * 60 * 1000;
  while (Date.now() < deadline) {
    const st = transferFlowStatus(rec);
    say(st.phase);
    if (st.phase === "complete") return { id: rec.id, landed: true };
    if (st.phase === "failed") throw new Error((rec as any).degradationReason || "Bridge failed on Rome settle");
    await sleep(7000);
    rec = await getTransfer(rec.id, api);
  }
  return { id: rec.id, landed: false };
}

/**
 * Finish a bridge whose burn already happened but never got registered. Quotes
 * fresh (the burn + settle calldata are deterministic for the same inputs, so the
 * bridge verifies the ORIGINAL burn against the new quote), has the wallet re-sign
 * the settle authorization for `burnHash`, registers, and polls. Nothing is burned
 * or spent again.
 */
export async function resumeBridge(opts: {
  cfg: PathConfig;
  apiBase: string;
  provider: Eip1193;
  source: BridgeSource;
  evmAddress: Hex;
  amount6: bigint;
  speed?: "standard" | "fast";
  burnHash: string;
  onPhase?: (p: BridgePhase) => void;
}): Promise<{ id: string; landed: boolean }> {
  const { cfg, apiBase, provider, source, evmAddress, amount6, speed = "standard", burnHash, onPhase } = opts;
  const api = { base: apiBase.replace(/\/$/, "") };
  const say = (phase: string, extra?: Partial<BridgePhase>) => onPhase?.({ phase, ...extra });

  // Don't ask the user to sign something the bridge is certain to reject: a burn sent by
  // a relayer (not by this account) fails registration with source-tx-mismatch.
  if ((await burnWasRelayed(source.rpcUrl, burnHash, evmAddress)) === true) {
    markPendingBlocked(burnHash);
    throw new BridgeAfterBurnError(
      { code: "rome.bridge.source-tx-mismatch", status: 400, detail: "this burn was sent by a relayer, not by your account (a smart-account wallet), so the bridge can't verify it" },
      burnHash,
    );
  }

  say("quoting");
  const quote = await requestQuote(inboundCctpQuoteRequest({ sourceChainId: source.chainId, romeChainId: cfg.chainId, amount: amount6, evmAddress, speed }), api);
  // the settle authorization's EIP-712 domain is the SOURCE chain; wallets refuse to sign on another chain
  say("switch-network", { detail: source.name });
  await ensureSourceChain(provider, source);
  return finishFromBurn({ api, provider, evmAddress, quote, burnHash, say });
}
