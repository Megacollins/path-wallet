// The Path mark: an ornate "P" formed by concentric parallel gold lines — a
// long column-like stem stepped by nested strokes that loop into a nested bowl,
// finished with a fluted base. Evokes an engraved Roman monogram.
import { motion } from "framer-motion";

// Three nested P outlines (stem steps right 20→27→34; bowl radius shrinks).
const RINGS = [
  "M20 60 V12 H40 A14 14 0 0 1 40 40 H20",
  "M27 60 V18 H39 A10 10 0 0 1 39 38 H27",
  "M34 60 V24 H38 A6 6 0 0 1 38 36 H34",
];

export function PathMark({ size = 40, animated = false }: { size?: number; animated?: boolean }) {
  const gid = `pg-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="8" y1="8" x2="60" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F4E7BC" />
          <stop offset="0.4" stopColor="#E4C765" />
          <stop offset="0.72" stopColor="#C9A227" />
          <stop offset="1" stopColor="#7E6416" />
        </linearGradient>
      </defs>
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* engraved shadow */}
        {RINGS.map((d, i) => (
          <path key={`s${i}`} d={d} stroke="#000" strokeOpacity="0.55" strokeWidth="3.4" transform="translate(0.5 1)" />
        ))}
        {/* gold concentric strokes */}
        {RINGS.map((d, i) => (
          <motion.path
            key={`g${i}`}
            d={d}
            stroke={`url(#${gid})`}
            strokeWidth={3.2 - i * 0.35}
            initial={animated ? { pathLength: 0, opacity: 0 } : false}
            animate={animated ? { pathLength: 1, opacity: 1 } : undefined}
            transition={{ duration: 1, delay: i * 0.18, ease: "easeInOut" }}
          />
        ))}
        {/* fluted column base under the stems */}
        <path d="M15 63 H41" stroke={`url(#${gid})`} strokeWidth="2.6" />
        <path d="M18 60 V63 M24 60 V63 M30 60 V63 M36 60 V63" stroke={`url(#${gid})`} strokeWidth="1.4" strokeOpacity="0.75" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 40, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <div className="flex items-center gap-3 select-none">
      <PathMark size={size} animated={animated} />
      <span className="font-serif font-semibold tracking-wide text-parchment" style={{ fontSize: size * 0.64, lineHeight: 1 }}>
        Path
      </span>
    </div>
  );
}
