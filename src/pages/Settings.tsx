// Settings — network facts (all registry-sourced), connected lanes, the token
// catalog, and the modular SmartAccount status.
import { cfg } from "../config";
import { useWallets } from "../wallet";
import { PathMark } from "../components/Logo";
import { Card, Copyable, Eyebrow, TokenGlyph } from "../components/ui";

export function Settings() {
  const { evm, solana, synthetic } = useWallets();

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Configuration</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">Settings</h1>
      </div>

      {/* Network */}
      <Card>
        <h2 className="font-serif text-xl text-parchment">Network</h2>
        <p className="mt-1 text-sm text-parchment/50">Resolved from @rome-protocol/registry — nothing hardcoded.</p>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Chain">
            {cfg.chainName} <span className="text-parchment/40">({cfg.network})</span>
          </Row>
          <Row label="Chain ID">
            <span className="tabular">{cfg.chainId}</span>
          </Row>
          <Row label="EVM RPC">
            <Copyable text={cfg.proxyUrl} display={cfg.proxyUrl} />
          </Row>
          <Row label="Solana RPC">
            <Copyable text={cfg.solanaRpc} display={cfg.solanaRpc} />
          </Row>
          <Row label="Rome EVM program">
            <Copyable text={cfg.programId} />
          </Row>
          <Row label="Explorer">
            <a href={cfg.explorerUrl} target="_blank" rel="noreferrer" className="text-gold-200 hover:underline text-sm">
              Open ↗
            </a>
          </Row>
        </dl>
      </Card>

      {/* Lanes */}
      <Card>
        <h2 className="font-serif text-xl text-parchment">Connected lanes</h2>
        <div className="mt-4 space-y-3">
          <LaneLine glyph="🦊" name="MetaMask · EVM" connected={Boolean(evm.address)}>
            {evm.address ? (
              <div className="flex flex-wrap items-center gap-2">
                <Copyable text={evm.address} />
                {!evm.isRome && (
                  <button onClick={() => evm.switchToRome()} className="text-[11px] text-terracotta-300 underline">
                    wrong network — switch
                  </button>
                )}
                <button onClick={() => evm.disconnect()} className="text-[11px] text-parchment/40 hover:text-parchment/70 underline">
                  disconnect
                </button>
              </div>
            ) : evm.available ? (
              <button onClick={() => evm.connect()} className="btn-gold !px-3 !py-1 text-xs">
                Connect
              </button>
            ) : (
              <span className="text-xs text-parchment/40">not installed</span>
            )}
          </LaneLine>

          <div className="rule-gold" />

          <LaneLine glyph="👻" name="Phantom · Solana" connected={solana.connected}>
            {solana.connected && solana.publicKey ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Copyable text={solana.publicKey.toBase58()} />
                  <button onClick={() => solana.disconnect()} className="text-[11px] text-parchment/40 hover:text-parchment/70 underline">
                    disconnect
                  </button>
                </div>
                {synthetic && (
                  <div className="flex items-center gap-1.5 text-[11px] text-parchment/40">
                    <span>synthetic EVM identity:</span>
                    <Copyable text={synthetic} />
                  </div>
                )}
              </div>
            ) : solana.available ? (
              <button onClick={() => solana.connect()} className="btn-gold !px-3 !py-1 text-xs">
                Connect
              </button>
            ) : (
              <span className="text-xs text-parchment/40">not installed</span>
            )}
          </LaneLine>
        </div>
      </Card>

      {/* Smart account */}
      <Card>
        <h2 className="font-serif text-xl text-parchment">Smart account</h2>
        <p className="mt-1 text-sm text-parchment/55">
          Path's modular <code className="text-gold-200">SmartAccount</code> can be owned by both an EVM EOA and a Solana synthetic address, with
          a module system for session keys, recovery, and spend limits.
        </p>
        {cfg.smartAccount ? (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="chip">deployed</span>
            <Copyable text={cfg.smartAccount} />
          </div>
        ) : (
          <pre className="mt-3 overflow-x-auto rounded-lg border border-gold/15 bg-stone-950/60 p-3 text-xs text-parchment/80">
{`npm run deploy:account   # deploy SmartAccount
# then set SMART_ACCOUNT_ADDRESS in .env`}
          </pre>
        )}
      </Card>

      {/* Tokens */}
      <Card>
        <h2 className="font-serif text-xl text-parchment">Tracked assets</h2>
        <ul className="mt-4 divide-y divide-gold/8">
          {cfg.tokens.map((t) => (
            <li key={t.symbol} className="flex items-center gap-3 py-2.5">
              <TokenGlyph symbol={t.symbol} size={30} />
              <div className="flex-1">
                <div className="text-sm text-parchment">
                  {t.symbol} <span className="text-parchment/40">· {t.name}</span>
                </div>
                <Copyable text={t.address} />
              </div>
              <span className="chip !py-0.5 !text-[10px]">{t.kind}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex items-center justify-center gap-3 pt-2 text-center opacity-60">
        <PathMark size={26} />
        <p className="text-xs text-parchment/40">Path · dual-lane smart wallet on Rome · a foundation for continuous shipping</p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label-eyebrow">{label}</dt>
      <dd className="mt-0.5 text-sm text-parchment/85">{children}</dd>
    </div>
  );
}

function LaneLine({ glyph, name, connected, children }: { glyph: string; name: string; connected: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full border border-gold/25 bg-stone-800 text-lg">{glyph}</span>
        <div>
          <div className="text-sm text-parchment">{name}</div>
          <div className={`text-[11px] ${connected ? "text-emerald-300" : "text-parchment/40"}`}>{connected ? "connected" : "not connected"}</div>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
