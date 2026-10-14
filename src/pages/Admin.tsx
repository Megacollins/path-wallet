// Admin: who is using Path, what they've earned, and whether the indexer is healthy. Only accounts that have a wallet
// from the server's ADMIN_WALLETS list linked can load any of this; for everyone else the API answers 403 and this
// page says so. Read-only, apart from "Run indexer now", which only reads the chain and appends ledger rows.
import { useCallback, useEffect, useState } from "react";
import { shorten } from "../../lib/format";
import { useAccount } from "../account";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { Button, Card, Copyable, EmptyState, Eyebrow, Skeleton, Spinner } from "../components/ui";
import { XP_NAME, ruleLabel } from "../lib/xp";

interface Wallet { kind: "evm" | "solana"; address: string; syntheticAddress: string | null }
interface Overview {
  accounts: { total: number; new24h: number; new7d: number; bothLanes: number };
  wallets: { evm: number; solana: number };
  active: { today: number; week: number };
  points: { season: string; totalPoints: number; byRule: { rule: string; points: number; entries: number }[]; top: { rank: number; accountId: string; points: number; wallets: number }[] };
  vault: { kind: string; chainId: number; events: number; amount: string }[];
  indexer: {
    snapshots: number;
    newestEventSeenAt: string | null;
    lastFullRun: { at: string; tookMs: number; wallets: number; awarded: number; errors: number; firstError: string | null } | null;
    lastAccountSync: { at: string } | null;
  };
}
interface Row { id: string; createdAt: string; points: number; lastEarnedAt: string | null; wallets: Wallet[] }
interface Detail {
  id: string;
  createdAt: string;
  total: number;
  wallets: (Wallet & { linkedAt: string })[];
  byRule: { rule: string; points: number; entries: number }[];
  recent: { rule: string; points: number; day: string | null; at: string }[];
  romeTransactions: { address: string; chainId: number; count: number; asOf: string }[];
  events: { kind: string; chainId: number; amount: string | null; status: string | null; at: string | null }[];
}

class Forbidden extends Error {}
async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 401 || res.status === 403) throw new Forbidden();
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const n = (v: number) => v.toLocaleString("en-US");
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const usdc = (base: string) => (Number(base) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function Admin() {
  const { status } = useAccount();
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await get<Overview>("/api/admin/overview"));
      setState("ok");
    } catch (e) {
      setState(e instanceof Forbidden ? "forbidden" : "error");
    }
  }, []);
  useEffect(() => {
    if (status === "authed") void load();
  }, [status, load]);

  async function runIndexer() {
    setRunning(true);
    setRan(null);
    try {
      const res = await fetch("/api/admin/run", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) setRan(body?.message ?? "The run didn't start.");
      else setRan(`Done in ${(body.tookMs / 1000).toFixed(1)}s: ${body.wallets} wallets, ${body.points?.awarded ?? 0} ${XP_NAME} awarded${body.errors?.length ? `, ${body.errors.length} errors (first: ${body.errors[0]})` : ""}.`);
      await load();
    } catch {
      setRan("The run couldn't be reached.");
    } finally {
      setRunning(false);
    }
  }

  if (status === "loading") return <Spinner className="h-5 w-5 text-gold-200" />;
  if (status !== "authed") return <ConnectPrompt title="Sign in to continue" hint="Admin is for the owner's account. Sign in on the XP or Settings page first." showDemo={false} />;
  if (state === "forbidden") return <Card><EmptyState glyph="🔒" title="Not available" hint="This account isn't an admin." /></Card>;

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Owner</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">Admin</h1>
        <p className="mt-1 max-w-2xl text-sm text-parchment/55">Who is using Path, what they've earned, and whether the indexer is keeping up.</p>
      </div>

      {state === "error" && <Card><p className="text-sm text-terracotta-300">Couldn't load the overview. <button className="underline" onClick={() => void load()}>Try again</button></p></Card>}
      {!data && state !== "error" && <Skeleton className="h-40 w-full" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Accounts" value={n(data.accounts.total)} sub={`+${data.accounts.new7d} this week · +${data.accounts.new24h} today`} />
            <Stat label="Wallets" value={n(data.wallets.evm + data.wallets.solana)} sub={`${data.wallets.evm} MetaMask · ${data.wallets.solana} Phantom`} />
            <Stat label="Both lanes" value={n(data.accounts.bothLanes)} sub="accounts with both linked" />
            <Stat label="Active" value={n(data.active.week)} sub={`${data.active.today} today · last 7 days`} />
            <Stat label={`${XP_NAME} issued`} value={n(data.points.totalPoints)} sub={`season ${data.points.season}`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-serif text-xl text-parchment">Top earners</h2>
              {data.points.top.length === 0 ? (
                <p className="mt-3 text-sm text-parchment/50">Nobody has earned {XP_NAME} yet.</p>
              ) : (
                <ol className="mt-3 divide-y divide-white/5 text-sm">
                  {data.points.top.map((t) => (
                    <li key={t.accountId}>
                      <button className="flex w-full items-center justify-between gap-3 py-2 text-left hover:text-champagne-100" onClick={() => setOpen(t.accountId)}>
                        <span className="text-parchment/45">{t.rank}.</span>
                        <span className="flex-1 font-mono text-xs text-parchment/75">{t.accountId.slice(0, 8)}</span>
                        <span className="text-parchment/45">{t.wallets} wallet{t.wallets === 1 ? "" : "s"}</span>
                        <span className="w-16 text-right text-parchment">{n(t.points)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <h3 className="mt-5 label-eyebrow">By rule</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {data.points.byRule.map((r) => (
                  <li key={r.rule} className="flex justify-between text-parchment/75">
                    <span>{ruleLabel(r.rule)}</span>
                    <span>{n(r.points)} <span className="text-parchment/40">({n(r.entries)})</span></span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2 className="font-serif text-xl text-parchment">Indexer</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Fact label="Last full run">{data.indexer.lastFullRun ? `${ago(data.indexer.lastFullRun.at)} · ${(data.indexer.lastFullRun.tookMs / 1000).toFixed(1)}s` : "never recorded"}</Fact>
                <Fact label="Last run's errors">{data.indexer.lastFullRun ? (data.indexer.lastFullRun.errors === 0 ? "none" : `${data.indexer.lastFullRun.errors}: ${data.indexer.lastFullRun.firstError ?? ""}`) : "—"}</Fact>
                <Fact label="Last user sync">{ago(data.indexer.lastAccountSync?.at ?? null)}</Fact>
                <Fact label="Newest event seen">{ago(data.indexer.newestEventSeenAt)}</Fact>
                <Fact label="Wallet snapshots">{n(data.indexer.snapshots)}</Fact>
                <Fact label="Vault events">{data.vault.length === 0 ? "none" : data.vault.map((v) => `${v.events} ${v.kind.replace("vault_", "")} (${usdc(v.amount)} wUSDC)`).join(", ")}</Fact>
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={runIndexer} loading={running} disabled={running}>Run indexer now</Button>
                <span className="text-xs text-parchment/45">Same as the daily job. Safe to repeat.</span>
              </div>
              {ran && <p className="mt-3 break-words text-xs text-parchment/65">{ran}</p>}
            </Card>
          </div>

          <Accounts open={open} setOpen={setOpen} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="!p-4">
      <div className="label-eyebrow">{label}</div>
      <div className="mt-1 font-serif text-2xl text-parchment">{value}</div>
      <div className="mt-0.5 text-[11px] text-parchment/45">{sub}</div>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-eyebrow">{label}</dt>
      <dd className="mt-0.5 break-words text-parchment/85">{children}</dd>
    </div>
  );
}

const PAGE = 20;

function Accounts({ open, setOpen }: { open: string | null; setOpen: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "points">("points");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Row[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setFailed(false);
      get<{ total: number; rows: Row[] }>(`/api/admin/accounts?q=${encodeURIComponent(q)}&sort=${sort}&limit=${PAGE}&offset=${page * PAGE}`)
        .then((d) => alive && setData(d))
        .catch(() => alive && setFailed(true));
    }, q ? 250 : 0); // wait for a pause in typing
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, sort, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl text-parchment">Accounts {data && <span className="text-sm text-parchment/45">({n(data.total)})</span>}</h2>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Search address or id"
            aria-label="Search accounts"
            className="w-52 rounded-xl border border-white/10 bg-stone-900/60 px-3 py-2 text-sm text-parchment placeholder:text-parchment/30 focus:border-champagne/50 focus:outline-none"
          />
          <button
            className="btn-ghost !px-3 !py-2 text-xs"
            onClick={() => {
              setSort(sort === "points" ? "new" : "points");
              setPage(0);
            }}
          >
            {sort === "points" ? `Most ${XP_NAME}` : "Newest"}
          </button>
        </div>
      </div>

      {failed && <p className="mt-3 text-sm text-terracotta-300">Couldn't load accounts.</p>}
      {!data && !failed && <Skeleton className="mt-4 h-24 w-full" />}
      {data && data.rows.length === 0 && <p className="mt-4 text-sm text-parchment/50">No accounts match.</p>}
      {data && data.rows.length > 0 && (
        <ul className="mt-3 divide-y divide-white/5">
          {data.rows.map((r) => (
            <li key={r.id} className="py-3">
              <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="font-mono text-xs text-parchment/75">{r.id.slice(0, 8)}</span>
                <span className="flex flex-1 flex-wrap gap-1.5">
                  {r.wallets.map((w) => (
                    <span key={w.address} className="chip !py-0.5 !text-[11px]">{w.kind === "evm" ? "🦊" : "👻"} {shorten(w.address, 6, 4)}</span>
                  ))}
                </span>
                <span className="text-xs text-parchment/40">joined {ago(r.createdAt)}</span>
                <span className="w-16 text-right text-sm text-parchment">{n(r.points)}</span>
              </button>
              {open === r.id && <AccountDetail id={r.id} />}
            </li>
          ))}
        </ul>
      )}
      {open && data && !data.rows.some((r) => r.id === open) && (
        <div className="mt-3 border-t border-white/5 pt-3"><AccountDetail id={open} /></div>
      )}

      {data && pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-parchment/55">
          <button className="btn-ghost !px-3 !py-1.5" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {pages}</span>
          <button className="btn-ghost !px-3 !py-1.5" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </Card>
  );
}

function AccountDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setD(null);
    setFailed(false);
    get<Detail>(`/api/admin/account?id=${id}`)
      .then((x) => alive && setD(x))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);

  if (failed) return <p className="mt-3 text-sm text-terracotta-300">Couldn't load this account.</p>;
  if (!d) return <Skeleton className="mt-3 h-20 w-full" />;
  return (
    <div className="mt-3 grid gap-5 rounded-xl bg-stone-900/40 p-4 text-sm lg:grid-cols-2">
      <div className="space-y-3">
        <div className="label-eyebrow">Account</div>
        <div className="font-mono text-xs break-all text-parchment/75">{d.id}</div>
        <ul className="space-y-1.5">
          {d.wallets.map((w) => (
            <li key={w.address} className="text-parchment/80">
              <span className="mr-2">{w.kind === "evm" ? "🦊" : "👻"}</span>
              <Copyable text={w.address} />
              {w.syntheticAddress && <div className="ml-6 text-xs text-parchment/45">Rome identity <Copyable text={w.syntheticAddress} /></div>}
            </li>
          ))}
        </ul>
        <div className="label-eyebrow">Rome transactions</div>
        {d.romeTransactions.length === 0 ? <p className="text-parchment/45">No snapshots yet.</p> : (
          <ul className="space-y-1">
            {d.romeTransactions.map((t) => (
              <li key={`${t.address}:${t.chainId}`} className="flex justify-between text-parchment/75">
                <span>{shorten(t.address, 6, 4)} · chain {t.chainId}</span>
                <span>{n(t.count)} <span className="text-parchment/40">as of {ago(t.asOf)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3">
        <div className="label-eyebrow">{XP_NAME}: {n(d.total)}</div>
        <ul className="space-y-1">
          {d.byRule.map((r) => (
            <li key={r.rule} className="flex justify-between text-parchment/75"><span>{ruleLabel(r.rule)}</span><span>{n(r.points)}</span></li>
          ))}
        </ul>
        <div className="label-eyebrow">Latest entries</div>
        {d.recent.length === 0 ? <p className="text-parchment/45">None.</p> : (
          <ul className="max-h-40 space-y-1 overflow-auto pr-1">
            {d.recent.slice(0, 15).map((r, i) => (
              <li key={i} className="flex justify-between text-xs text-parchment/65"><span>{ruleLabel(r.rule)} · {r.day ?? ago(r.at)}</span><span>+{r.points}</span></li>
            ))}
          </ul>
        )}
        {d.events.length > 0 && (
          <>
            <div className="label-eyebrow">Bridge and Vault events</div>
            <ul className="max-h-32 space-y-1 overflow-auto pr-1">
              {d.events.slice(0, 10).map((e, i) => (
                <li key={i} className="flex justify-between text-xs text-parchment/65">
                  <span>{e.kind.replace("_", " ")}{e.status ? ` · ${e.status}` : ""}</span>
                  <span>{e.amount ? `${usdc(e.amount)} · ` : ""}{ago(e.at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
