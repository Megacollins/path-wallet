// A sculpted, polished-gold medallion bearing the Path monogram — the centerpiece
// "sculpture" that sits inside the marble arch. Built from layered radial/linear
// gold gradients with specular highlights and a beveled rim for real relief.
import { motion } from "framer-motion";

const RINGS = [
  "M20 60 V12 H40 A14 14 0 0 1 40 40 H20",
  "M27 60 V18 H39 A10 10 0 0 1 39 38 H27",
  "M34 60 V24 H38 A6 6 0 0 1 38 36 H34",
];

export function GoldMedallion({ size = 260 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      initial={{ opacity: 0, scale: 0.9, rotateZ: -4 }}
      animate={{ opacity: 1, scale: 1, rotateZ: 0 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      style={{ filter: "drop-shadow(0 24px 40px rgba(0,0,0,0.75)) drop-shadow(0 0 42px rgba(201,162,39,0.4))" }}
    >
      <defs>
        <radialGradient id="med-face" cx="38%" cy="32%" r="80%">
          <stop offset="0" stopColor="#fff4cf" />
          <stop offset="26%" stopColor="#eecb74" />
          <stop offset="58%" stopColor="#c49a34" />
          <stop offset="82%" stopColor="#8a6a1e" />
          <stop offset="100%" stopColor="#5c4614" />
        </radialGradient>
        <linearGradient id="med-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fdf1c4" />
          <stop offset="35%" stopColor="#d3ab4d" />
          <stop offset="60%" stopColor="#8c6c1f" />
          <stop offset="100%" stopColor="#f0d68c" />
        </linearGradient>
        <radialGradient id="med-recess" cx="50%" cy="42%" r="70%">
          <stop offset="0" stopColor="#7c5f1c" />
          <stop offset="70%" stopColor="#4f3c11" />
          <stop offset="100%" stopColor="#2e2209" />
        </radialGradient>
        <linearGradient id="med-p" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff8e2" />
          <stop offset="45%" stopColor="#f0d074" />
          <stop offset="100%" stopColor="#a37f22" />
        </linearGradient>
        <radialGradient id="med-spec" cx="34%" cy="26%" r="40%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* outer beveled rim */}
      <circle cx="100" cy="100" r="96" fill="url(#med-rim)" />
      <circle cx="100" cy="100" r="88" fill="url(#med-recess)" />
      {/* engraved dotted bezel ring */}
      <circle cx="100" cy="100" r="82" fill="none" stroke="#f2dc9c" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="1.5 5" />
      {/* raised gold face */}
      <circle cx="100" cy="100" r="76" fill="url(#med-face)" />
      <circle cx="100" cy="100" r="76" fill="url(#med-spec)" />
      {/* the monogram, centered */}
      <g transform="translate(64 64) scale(1.12)" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {RINGS.map((d, i) => (
          <path key={`sh${i}`} d={d} stroke="#3a2b0a" strokeOpacity="0.6" strokeWidth={3.6} transform="translate(0.6 1)" />
        ))}
        {RINGS.map((d, i) => (
          <path key={`p${i}`} d={d} stroke="url(#med-p)" strokeWidth={3.4 - i * 0.35} />
        ))}
        <path d="M15 63 H41" stroke="url(#med-p)" strokeWidth="2.6" />
      </g>
    </motion.svg>
  );
}
