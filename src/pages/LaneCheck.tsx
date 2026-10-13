// Solana-lane check: what the Phantom lane needs from your wallet, and whether your wallet can do it. A troubleshooting
// page (reach it at /lane-check): it reads state and asks the wallet to SIGN test data, but never sends a transaction.
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { composeProbeWire, laneStatus, type LaneStatus } from "../../lib/romeSolana";
import { useCfg } from "../network";
import { useWallets } from "../wallet";
import { probeLaneSupport, type LaneSupport } from "../wallet/laneSigner";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { Button, Card, Copyable, Eyebrow, Spinner } from "../components/ui";

export function LaneCheck() {
  const cfg = useCfg();
  const { solana } = useWallets();
  const [status, setStatus] = useState<LaneStatus | null>(null);
  const [support, setSupport] = useState<LaneSupport | null | "none">(null);
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
      const r = await probeLaneSupport(key, () => composeProbeWire(cfg, key));
      setSupport(r ?? "none");
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
                <Result ok={support.message.ok} title="Sign the authorization message" detail={support.message.ok ? `${support.walletName} signed it.` : support.message.error} />
                <Result ok={support.v1Wire.ok} title="Sign a v1 transaction" detail={support.v1Wire.ok ? `${support.walletName} signed a real composed v1 transaction.` : support.v1Wire.error} />
                <li className="pt-1 text-xs leading-relaxed text-parchment/50">
                  {support.message.ok && support.v1Wire.ok
                    ? "Both work: the full lane (direct route and gas top-ups) is possible with this wallet."
                    : support.message.ok
                      ? "Messages work but v1 transactions don't: only the relay route is possible, and gas can't be topped up from this wallet."
                      : "This wallet can't sign for the lane at all."}
                </li>
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

function Result({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${ok ? "bg-emerald-500/20 text-emerald-300" : "bg-terracotta-500/20 text-terracotta-300"}`}>{ok ? "✓" : "✕"}</span>
      <div className="min-w-0">
        <div className="text-parchment">{title}</div>
        <div className={`break-words text-xs ${ok ? "text-parchment/50" : "text-terracotta-300"}`}>{detail}</div>
      </div>
    </li>
  );
}
