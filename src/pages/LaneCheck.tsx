// Solana-lane check: what the Phantom lane needs from your wallet, and whether your wallet can do it. A troubleshooting
// page (reach it at /lane-check): it reads state and asks the wallet to SIGN test data, but never sends a transaction.
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { laneStatus, probeLane, type LaneProbe, type LaneStatus, type Probe } from "../../lib/romeSolana";
import { useCfg } from "../network";
import { useWallets } from "../wallet";
import { laneSignerFor } from "../wallet/laneSigner";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { Button, Card, Copyable, Eyebrow, Spinner } from "../components/ui";

export function LaneCheck() {
  const cfg = useCfg();
  const { solana } = useWallets();
  const [status, setStatus] = useState<LaneStatus | null>(null);
  const [support, setSupport] = useState<(LaneProbe & { walletName: string }) | null | "none">(null);
  const [busy, setBusy] = useState(false);

  const key = solana.publicKey;
  const load = useCallback(async () => {
    if (key) setStatus(await laneStatus(cfg, key));
  }, [cfg, key]);
  useEffect(() => {
    setStatus(null);
    setSupport(null);
    void load();
  }, [load]);

  async function runProbe() {
    if (!key) return;
    setBusy(true);
    try {
      const found = await laneSignerFor(key, { connect: true });
      if (!found) return setSupport("none");
      setSupport({ ...(await probeLane(cfg, found.signer)), walletName: found.walletName });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Troubleshooting</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">Solana lane check</h1>
        <p className="mt-1 max-w-2xl text-sm text-parchment/55">
          What the Phantom lane needs, and whether your wallet can do it. This only reads, and asks your wallet to sign test data. It never sends a transaction.
        </p>
      </div>

      {!key ? (
        <ConnectPrompt title="Connect Phantom" hint="Connect your Phantom wallet to check it against Rome's Solana lane." showDemo={false} />
      ) : (
        <>
          <Card>
            <h2 className="font-serif text-xl text-parchment">Your wallet</h2>
            {!status ? (
              <Spinner className="mt-4 h-5 w-5 text-gold-200" />
            ) : (
              <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Row label="Solana wallet">
                  <Copyable text={key.toBase58()} />
                </Row>
                <Row label="Rome identity (synthetic)">
                  <Copyable text={status.synthetic} />
                </Row>
                <Row label="SOL (Solana fees)">{formatUnits(status.lamports, 9)} SOL</Row>
                <Row label="USDC in your wallet">{formatUnits(status.walletUsdc, 6)} USDC</Row>
                <Row label="Synthetic set up">{status.provisioned ? "yes" : "not yet (one-time setup)"}</Row>
                <Row label="Synthetic gas balance">{formatUnits(status.gasWei, 18)} USDC</Row>
                <Row label="wUSDC on the synthetic">{formatUnits(status.syntheticWusdc, 6)} wUSDC</Row>
              </dl>
            )}
          </Card>

          <Card>
            <h2 className="font-serif text-xl text-parchment">Can your wallet sign for Rome's lane?</h2>
            <p className="mt-1 max-w-2xl text-sm text-parchment/55">
              Rome's lane asks your wallet to sign twice per action: a readable message, then a transaction in Solana's new "v1" format. Some wallets can't read that format yet. This asks your wallet to sign one of each, and throws the signatures away.
            </p>
            <Button className="mt-4" onClick={runProbe} loading={busy} disabled={busy || !status || status.lamports === 0n}>
              Test my wallet
            </Button>
            {status && status.lamports === 0n && <p className="mt-2 text-xs text-terracotta-300">The test needs a little SOL in the wallet (the test transaction is built for a real, existing account).</p>}

            {support === "none" && <p className="mt-4 text-sm text-terracotta-300">No Wallet Standard wallet holding this key was found, so the lane can't talk to your wallet directly yet.</p>}
            {support && support !== "none" && (
              <ul className="mt-4 space-y-3 text-sm">
                <Result probe={support.message} title="Sign the authorization message" okText={`${support.walletName} signed it.`} />
                <Result probe={support.v1Wire} title="Sign a v1 transaction" okText={`${support.walletName} signed a real composed v1 transaction, and the signature checks out. (Nothing was sent.)`} />
                <li className="pt-1 text-xs leading-relaxed text-parchment/50">{verdict(support)}</li>
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-eyebrow">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-parchment/85">{children}</dd>
    </div>
  );
}

function verdict(p: LaneProbe): string {
  if (p.message.state === "ok" && p.v1Wire.state === "ok") return "Both work: the full lane (direct route and gas top-ups) is possible with this wallet.";
  if (p.v1Wire.state === "failed") return p.message.state === "ok" ? "Messages work but your wallet can't sign v1 transactions: only the relay route is possible, and gas can't be topped up from this wallet." : "Your wallet couldn't sign for the lane.";
  if (p.message.state === "failed") return "Your wallet couldn't sign the authorization message.";
  return "Inconclusive: Rome's transaction builder stopped before your wallet was asked to sign the transaction, so this says nothing about your wallet yet. See the reason above.";
}

function Result({ probe, title, okText }: { probe: Probe; title: string; okText: string }) {
  const tone = probe.state === "ok" ? "bg-emerald-500/20 text-emerald-300" : probe.state === "failed" ? "bg-terracotta-500/20 text-terracotta-300" : "bg-stone-700/60 text-parchment/60";
  const mark = probe.state === "ok" ? "✓" : probe.state === "failed" ? "✕" : "?";
  const detail = probe.state === "ok" ? okText : probe.state === "failed" ? probe.error : `Not tested: ${probe.reason}`;
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${tone}`}>{mark}</span>
      <div className="min-w-0">
        <div className="text-parchment">{title}</div>
        <div className={`break-words text-xs ${probe.state === "failed" ? "text-terracotta-300" : "text-parchment/50"}`}>{detail}</div>
      </div>
    </li>
  );
}
