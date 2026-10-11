// XP — what this account has earned from activity on Rome. Read-only: everything shown is computed on the
// server from the append-only ledger. Devnet XP is a test of the system, not a promise of any reward.
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { shorten } from "../../lib/format";
import { useAccount } from "../account";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { Card, EmptyState, Eyebrow, Skeleton, Spinner } from "../components/ui";
import { RANKS, XP_NAME, rankFor, ruleLabel, type XpData } from "../lib/xp";

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** The last 30 UTC days, oldest first, with zero for days with no XP. */
function last30(daily: XpData["daily"]) {
  const byDay = new Map(daily.map((d) => [d.day, d.points]));
  const out: { day: string; points: number }[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const day = d.toISOString().slice(0, 10);
    out.push({ day, points: byDay.get(day) ?? 0 });
  }
  return out;
}

export function Xp() {
  const { status, xp, xpLoading, refreshXp } = useAccount();

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Devnet season{xp ? ` · ${xp.season}` : ""}</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">{XP_NAME}</h1>
        <p className="mt-1 max-w-2xl text-sm text-parchment/55">
          Earned from what you do on Rome: transactions, active days, bridging in, using both lanes. Devnet {XP_NAME} is a test of the system, not a promise of any reward.
        </p>
      </div>

      {status === "loading" && <Skeleton className="h-48 w-full" />}

      {status === "unavailable" && <Card><EmptyState glyph="⌛" title={`${XP_NAME} isn't available right now`} hint="The account service can't be reached. Your wallet works as normal; try again in a little while." /></Card>}

      {status === "anon" && (
        <Card>
          <h2 className="font-serif text-xl text-parchment">Sign in to start earning {XP_NAME}</h2>
          <p className="mt-1 max-w-xl text-sm text-parchment/60">
            Signing in is a free signature with your wallet: no transaction, no gas. It links your MetaMask and Phantom into one account so your activity on both lanes counts together.
          </p>
          <Link to="/settings" className="btn-gold mt-4 inline-flex">
            Open Settings to sign in
          </Link>
        </Card>
      )}

      {status === "authed" && !xp && <Skeleton className="h-48 w-full" />}

      {status === "authed" && xp && <Earned xp={xp} loading={xpLoading} onRefresh={refreshXp} />}
    </div>
  );
}

function Earned({ xp, loading, onRefresh }: { xp: XpData; loading: boolean; onRefresh: () => void }) {
  const r = rankFor(xp.total);
  const days = last30(xp.daily);
  const max = Math.max(1, ...days.map((d) => d.points));
  const earnedBy = new Map(xp.byRule.map((b) => [b.rule, b]));

  return (
    <>
      {/* Total + rank */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="label-eyebrow">Total {XP_NAME}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tabular font-serif text-5xl text-parchment sm:text-6xl">
                <AnimatedNumber value={xp.total} format={(n) => Math.round(n).toLocaleString("en-US")} />
              </span>
              <span className="text-sm text-parchment/45">{XP_NAME}</span>
            </div>
          </div>
          <button onClick={onRefresh} disabled={loading} className="btn-ghost !px-3 !py-2 text-xs" aria-label={`Refresh ${XP_NAME}`}>
            {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
            Refresh
          </button>
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm text-parchment">
              <span className="text-parchment/45">Level {r.level} · </span>
              <span className="font-serif text-lg text-champagne-100">{r.rank.name}</span>
            </span>
            <span className="text-xs text-parchment/50">{r.next ? `${r.toNext.toLocaleString("en-US")} ${XP_NAME} to ${r.next.name}` : "Highest rank reached"}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-800/80" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)} aria-label="Progress to the next rank">
            <motion.div className="h-full rounded-full bg-gold-sheen" initial={{ width: 0 }} animate={{ width: `${r.progress * 100}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
          </div>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {RANKS.map((k, i) => (
              <li key={k.name} className={`chip !py-1 !text-[11px] ${i <= r.index ? "!border-champagne/50 !text-champagne-100" : "opacity-45"}`} title={`${k.from.toLocaleString("en-US")} ${XP_NAME}`}>
                {k.name}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Last 30 days */}
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-xl text-parchment">Last 30 days</h2>
          <span className="tabular text-xs text-parchment/45">{days.reduce((s, d) => s + d.points, 0).toLocaleString("en-US")} {XP_NAME}</span>
        </div>
        <div className="mt-4 flex h-24 items-end gap-[3px]" role="img" aria-label={`${XP_NAME} earned per day over the last 30 days`}>
          {days.map((d) => (
            <div key={d.day} className="flex h-full min-w-0 flex-1 items-end" title={`${dayLabel(d.day)}: ${d.points} ${XP_NAME}`}>
              <motion.div
                className={`w-full rounded-sm ${d.points > 0 ? "bg-gold-sheen" : "bg-stone-700/50"}`}
                initial={{ height: 2 }}
                animate={{ height: d.points > 0 ? `${Math.max(8, (d.points / max) * 100)}%` : 2 }}
                transition={{ duration: 0.6 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-parchment/35">
          <span>{dayLabel(days[0].day)}</span>
          <span>Today</span>
        </div>
      </Card>

      {/* How it's earned */}
      <Card>
        <h2 className="font-serif text-xl text-parchment">How you earn {XP_NAME}</h2>
        <ul className="mt-3 divide-y divide-gold/8">
          {xp.rules.map((rule) => {
            const got = earnedBy.get(rule.rule);
            return (
              <li key={rule.rule} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="text-sm text-parchment">
                    {ruleLabel(rule.rule)}
                    {!rule.enabled && <span className="chip ml-2 !py-0 !text-[10px]">coming soon</span>}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-parchment/50">{rule.text.replaceAll("{xp}", XP_NAME)}</p>
                </div>
                <div className="tabular shrink-0 text-right">
                  <div className={`text-sm ${got ? "text-champagne-100" : "text-parchment/30"}`}>{got ? `+${got.points.toLocaleString("en-US")}` : "0"}</div>
                  <div className="text-[11px] text-parchment/35">{got ? `${got.entries} ${got.entries === 1 ? "entry" : "entries"}` : "none yet"}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Recent */}
      <Card>
        <h2 className="font-serif text-xl text-parchment">Recent activity</h2>
        {xp.recent.length === 0 ? (
          <p className="mt-3 text-sm text-parchment/55">
            Nothing yet. Your {XP_NAME} starts with your next transaction on Rome after signing in. Counting begins from your latest sync, so earlier activity isn't included.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gold/8">
            {xp.recent.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-parchment">{ruleLabel(e.rule)}</div>
                  <div className="truncate text-[11px] text-parchment/40">
                    {e.day ? dayLabel(e.day) : "one-time"}
                    {e.address ? ` · ${shorten(e.address, 6, 4)}` : ""}
                  </div>
                </div>
                <span className="tabular shrink-0 text-sm text-champagne-100">+{e.points}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
