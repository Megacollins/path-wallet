// Luxury analytics widgets: an allocation ring and a value sparkline. Pure SVG,
// gold-toned, with gentle motion.
import { motion } from "framer-motion";
import { formatUsdCompact } from "../../lib/format";

const SLICE_COLORS = ["#E0C98E", "#C2A25C", "#B5533C", "#8A8069", "#9A7B4F"];

export function AllocationRing({
  data,
  size = 132,
}: {
  data: { symbol: string; usd: number; pct: number }[];
  size?: number;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
        {data.map((d, i) => {
          const len = (d.pct / 100) * c;
          const el = (
            <motion.circle
              key={d.symbol}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 + i * 0.08 }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <ul className="space-y-1.5">
        {data.map((d, i) => (
          <li key={d.symbol} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
            <span className="text-parchment/85 w-14">{d.symbol}</span>
            <span className="tabular text-parchment/45 text-xs">{d.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({ points, width = 260, height = 64 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => [i * step, height - ((p - min) / span) * (height - 8) - 4]);
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  const up = points[points.length - 1] >= points[0];
  const line = up ? "#E0C98E" : "#B5533C";
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={line} stopOpacity="0.25" />
          <stop offset="1" stopColor={line} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <motion.path
        d={d}
        fill="none"
        stroke={line}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: "easeInOut" }}
      />
    </svg>
  );
}
