// Dual-lane vault demo. A MetaMask user and a Phantom user deposit + withdraw
// the SAME wUSDC into the SAME Vault, sharing one state — the canonical proof of
// Rome's single-state, two-lane model. Extends the scaffold's flows in lib/rome.ts.
import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { parseAmountSafe } from "../../lib/format";
import * as rome from "../../lib/rome";
import { cfg } from "../config";
import { useWallets } from "../wallet";
import { usePortfolio } from "../hooks/usePortfolio";
import { useToast } from "../components/Toast";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { Button, Card, Copyable, Eyebrow, Skeleton } from "../components/ui";

type Lane = "evm" | "solana";

export function Vault() {
  const { evm, solana, synthetic, anyConnected } = useWallets();
  const toast = useToast();
  const vault = cfg.vault;

  const [lane, setLane] = useState<Lane>("evm");
  const activeLane: Lane = lane === "evm" && !evm.address && solana.connected ? "solana" : lane;

  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState<"deposit" | "withdraw" | "">("");
  const [evmBal, setEvmBal] = useState<string | null>(null);
  const [synthBal, setSynthBal] = useState<string | null>(null);

  const amt = parseAmountSafe(amount, 6);

  // Wallet-side balance (deposit source): native gas on the EVM lane (evmDeposit
  // wraps gas → wUSDC), Phantom's SPL wUSDC on the Solana lane (solanaFund pulls
  // from it). In-vault balance (withdraw source) is evmBal/synthBal above.
  const { data: portfolio } = usePortfolio();
  const gasRow = portfolio?.assets.find((a) => a.kind === "gas");
  const wusdcRow = portfolio?.assets.find((a) => a.symbol === "wUSDC");
  const walletBalance = activeLane === "evm" ? gasRow?.evmAmount ?? 0 : wusdcRow?.solAmount ?? 0;
  const walletSymbol = activeLane === "evm" ? gasRow?.symbol ?? "USDC" : "wUSDC";
  // Keep a little native gas back on the EVM lane so approve + deposit can still pay fees.
  const depositMax = activeLane === "evm" ? Math.max(0, walletBalance - 0.3) : walletBalance;
  const vaultBalance = Number((activeLane === "evm" ? evmBal : synthBal) ?? 0);

  const refresh = useCallback(async () => {
    if (!vault) return;
    if (evm.address) setEvmBal(formatUnits(await rome.vaultBalanceOf(cfg, vault, evm.address), 6));
    if (synthetic) setSynthBal(formatUnits(await rome.vaultBalanceOf(cfg, vault, synthetic), 6));
  }, [vault, evm.address, synthetic]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(kind: "deposit" | "withdraw", fn: () => Promise<unknown>, label: string) {
    setBusy(kind);
    try {
      await toast.run(label, fn, { success: "Confirmed" });
      await refresh();
    } catch {
      /* surfaced by toast */
    } finally {
      setBusy("");
    }
  }

  const evmDeposit = () =>
    run(
      "deposit",
      async () => {
        await rome.evmWrapToWusdc(evm.provider!, evm.address!, parseUnits(amount, 18));
        await rome.evmApprove(evm.provider!, evm.address!, cfg, vault!, amt!);
        await rome.evmDeposit(evm.provider!, evm.address!, vault!, amt!);
      },
      `Deposit ${amount} wUSDC (EVM)`,
    );
  const evmWithdraw = () => run("withdraw", () => rome.evmWithdraw(evm.provider!, evm.address!, vault!, amt!), `Withdraw ${amount} wUSDC (EVM)`);

  const solDeposit = () =>
    run(
      "deposit",
      async () => {
        await rome.solanaFund(cfg, solana.publicKey!, solana.signTransaction!, amt!);
        await rome.solanaApprove(cfg, solana.publicKey!, solana.signTransaction!, vault!, amt!);
        await rome.solanaDeposit(cfg, solana.publicKey!, solana.signTransaction!, vault!, amt!);
      },
      `Deposit ${amount} wUSDC (Solana)`,
    );
  const solWithdraw = () =>
    run(
      "withdraw",
      async () => {
        await rome.solanaWithdraw(cfg, solana.publicKey!, solana.signTransaction!, vault!, amt!);
        await rome.solanaSweep(cfg, solana.publicKey!, solana.signTransaction!, amt!);
      },
      `Withdraw ${amount} wUSDC (Solana)`,
    );

  const laneReady = activeLane === "evm" ? Boolean(evm.address) && evm.isRome : solana.connected && Boolean(solana.signTransaction);
  const canAct = Boolean(vault) && laneReady && amt != null && amt > 0n && !busy;

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Single state · two lanes</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">Vault</h1>
        <p className="mt-1 max-w-2xl text-sm text-parchment/55">
          One Vault contract. A MetaMask deposit and a Phantom deposit land in the same state — the clearest demonstration of Rome's shared
          accounts.
        </p>
      </div>

      {!anyConnected ? (
        <ConnectPrompt title="Connect to use the Vault" hint="Deposit from MetaMask, Phantom, or both — into one shared Vault." />
      ) : !vault ? (
        <Card className="border-terracotta-500/30">
          <Eyebrow>No Vault deployed</Eyebrow>
          <p className="mt-2 text-sm text-parchment/70">
            Deploy the Vault, then set <code className="text-gold-200">VAULT_ADDRESS</code> in <code className="text-gold-200">.env</code> and
            restart:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-gold/15 bg-stone-950/60 p-3 text-xs text-parchment/80">npm run deploy</pre>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <VaultBalanceCard glyph="🦊" title="MetaMask · EVM" who={evm.address ?? undefined} balance={evmBal} />
            <VaultBalanceCard glyph="👻" title="Phantom · Solana" who={synthetic ?? undefined} balance={synthBal} subLabel="synthetic" />
          </div>

          <Card className="max-w-xl">
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-gold/15 bg-stone-900/60 p-1">
              <button
                onClick={() => setLane("evm")}
                disabled={!evm.address}
                className={`rounded-lg py-2.5 text-sm transition ${
                  activeLane === "evm" ? "bg-gold-sheen text-stone-950 font-medium" : "text-parchment/60 disabled:opacity-30"
                }`}
              >
                🦊 EVM lane
              </button>
              <button
                onClick={() => setLane("solana")}
                disabled={!solana.connected}
                className={`rounded-lg py-2.5 text-sm transition ${
                  activeLane === "solana" ? "bg-gold-sheen text-stone-950 font-medium" : "text-parchment/60 disabled:opacity-30"
                }`}
              >
                👻 Solana lane
              </button>
            </div>

            {activeLane === "evm" && evm.address && !evm.isRome && (
              <div className="mb-4 rounded-xl border border-terracotta-500/40 bg-terracotta-500/10 p-3 text-sm text-terracotta-300">
                Wrong network.{" "}
                <button onClick={() => evm.switchToRome()} className="underline">
                  Switch to {cfg.chainName}
                </button>
              </div>
            )}

            <div className="flex items-baseline justify-between">
              <label className="label-eyebrow">Amount</label>
              {laneReady && (
                <span className="text-xs text-parchment/50">
                  Wallet: <span className="tabular text-parchment/80">{walletBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>{" "}
                  {walletSymbol}
                  <button
                    onClick={() => setAmount(String(depositMax))}
                    disabled={Boolean(busy) || depositMax <= 0}
                    className="ml-1.5 text-champagne-200 hover:text-champagne-100 disabled:opacity-40"
                  >
                    Max
                  </button>
                </span>
              )}
            </div>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="input-stone mt-2 text-lg" placeholder="0.1" />
            {laneReady && (
              <div className="mt-1.5 flex items-baseline justify-end text-[11px] text-parchment/40">
                In vault: <span className="tabular ml-1 text-parchment/60">{vaultBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>{" "}
                wUSDC
                <button
                  onClick={() => setAmount(String(vaultBalance))}
                  disabled={Boolean(busy) || vaultBalance <= 0}
                  className="ml-1.5 text-champagne-200 hover:text-champagne-100 disabled:opacity-40"
                >
                  Max
                </button>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button variant="gold" onClick={activeLane === "evm" ? evmDeposit : solDeposit} loading={busy === "deposit"} disabled={!canAct}>
                Deposit
              </Button>
              <Button variant="ghost" onClick={activeLane === "evm" ? evmWithdraw : solWithdraw} loading={busy === "withdraw"} disabled={!canAct}>
                Withdraw
              </Button>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-parchment/40">
              {activeLane === "evm"
                ? "EVM: wrap gas → wUSDC, approve, deposit — each via submitRomeTx."
                : "Solana: fund the synthetic, approve (auto-provisions), deposit — each via submitRomeTxSolanaLane. Withdraw sweeps back to your wallet."}
            </p>
          </Card>

          <p className="text-center text-xs text-parchment/35">
            Vault <Copyable text={vault} /> · shared by both lanes
          </p>
        </>
      )}
    </div>
  );
}

function VaultBalanceCard({
  glyph,
  title,
  who,
  balance,
  subLabel,
}: {
  glyph: string;
  title: string;
  who?: string;
  balance: string | null;
  subLabel?: string;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="text-lg">{glyph}</span>
        <span className="text-sm text-parchment">{title}</span>
      </div>
      <div className="mt-3 tabular font-serif text-3xl text-parchment">
        {who ? balance != null ? balance : <Skeleton className="h-8 w-24" /> : <span className="text-parchment/30 text-xl">not connected</span>}
        {who && balance != null && <span className="ml-1.5 text-sm text-parchment/40">wUSDC</span>}
      </div>
      {who && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-parchment/40">
          {subLabel && <span>{subLabel}:</span>}
          <Copyable text={who} />
        </div>
      )}
    </Card>
  );
}
