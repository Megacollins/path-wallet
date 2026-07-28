/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep charcoal / black stone
        stone: {
          950: "#0B0A08",
          900: "#12100C",
          850: "#181510",
          800: "#211D16",
          700: "#2C271E",
          600: "#3A3327",
        },
        // Strong muted gold
        gold: {
          50: "#FBF4DC",
          100: "#F1E3B4",
          200: "#E4C765",
          300: "#D8B646",
          DEFAULT: "#C9A227",
          500: "#C9A227",
          600: "#A9871D",
          700: "#846A18",
          800: "#5E4C12",
        },
        // Champagne / brushed gold — the luxury accent
        champagne: {
          100: "#F6EDD3",
          200: "#EBDCB4",
          DEFAULT: "#E0C98E",
          400: "#D3B571",
          500: "#C2A25C",
        },
        bronze: {
          DEFAULT: "#9A7B4F",
          600: "#7C6240",
        },
        // Terracotta accents
        terracotta: {
          300: "#D98A6E",
          DEFAULT: "#B5533C",
          500: "#B5533C",
          600: "#94402E",
        },
        marble: {
          light: "#EDE7DC",
          mid: "#C9C1B2",
          vein: "#8A8172",
        },
        parchment: "#E8E0CF",
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', "Georgia", "Cambria", "serif"],
        sans: ['Inter', 'system-ui', "-apple-system", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.4rem",
        "3xl": "1.75rem",
        "4xl": "2rem",
      },
      boxShadow: {
        carve: "inset 0 1px 0 0 rgba(233,224,207,0.06), inset 0 -1px 0 0 rgba(0,0,0,0.5), 0 20px 40px -24px rgba(0,0,0,0.8)",
        gold: "0 0 0 1px rgba(201,162,39,0.35), 0 8px 30px -12px rgba(201,162,39,0.35)",
        glowgold: "0 0 24px -6px rgba(201,162,39,0.55)",
        glass: "inset 0 1px 0 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(224,201,142,0.10), 0 30px 60px -30px rgba(0,0,0,0.9)",
        lux: "0 40px 80px -40px rgba(0,0,0,0.9), 0 12px 32px -20px rgba(0,0,0,0.7)",
      },
      backgroundImage: {
        "gold-sheen": "linear-gradient(135deg, #E4C765 0%, #C9A227 45%, #846A18 100%)",
        "stone-fade": "radial-gradient(120% 120% at 50% 0%, #1a1610 0%, #0B0A08 70%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "gold-pan": {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        shimmer: "shimmer 2.2s linear infinite",
        float: "float 6s ease-in-out infinite",
        "gold-pan": "gold-pan 6s linear infinite",
      },
    },
  },
  plugins: [],
};
