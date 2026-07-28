// Quick-action links into the Rome ecosystem. Every URL here is a REAL, verified
// destination — the official Rome repos (from the canonical AGENTS.md), the docs,
// and the live explorer. We deliberately don't invent hosted-app URLs we can't
// verify; each card is honestly labeled by where it points.

export type LinkKind = "app" | "docs" | "explorer" | "bridge" | "tool";

export interface EcosystemLink {
  name: string;
  blurb: string;
  url: string;
  kind: LinkKind;
  /** Where the link actually resolves — surfaced as a small honest badge. */
  target: "GitHub" | "Docs" | "Explorer" | "Web";
  /** Two-emoji glyph used as a lightweight icon. */
  glyph: string;
}

/** Static ecosystem entries (verified URLs). */
export const ECOSYSTEM: EcosystemLink[] = [
  {
    name: "Rome DEX",
    blurb: "Native AMM — one pool both an EVM and a Solana wallet trade, sharing reserves.",
    url: "https://github.com/rome-protocol/rome-dex",
    kind: "app",
    target: "GitHub",
    glyph: "⚖️",
  },
  {
    name: "Cardo",
    blurb: "Drive Jupiter, Meteora, Marinade & Mango on Solana from an EVM account via CPI.",
    url: "https://github.com/rome-protocol/cardo",
    kind: "app",
    target: "GitHub",
    glyph: "🪙",
  },
  {
    name: "Aave v3 on Rome",
    blurb: "Aave v3 running unchanged — lend and borrow from either lane.",
    url: "https://github.com/rome-protocol/rome-aave-v3",
    kind: "app",
    target: "GitHub",
    glyph: "🏦",
  },
  {
    name: "Aerarium",
    blurb: "Lending market — a Solidity core that Solana users reach via a synthetic sender.",
    url: "https://github.com/rome-protocol/aerarium",
    kind: "app",
    target: "GitHub",
    glyph: "🏛️",
  },
  {
    name: "Compound v3",
    blurb: "Compound Comet on Rome — the same markets, open to both audiences.",
    url: "https://github.com/rome-protocol/compound-on-rome-comet",
    kind: "app",
    target: "GitHub",
    glyph: "🧭",
  },
  {
    name: "Rome Docs",
    blurb: "Architecture, developer guides, and the precompile reference.",
    url: "https://docs.rome.builders",
    kind: "docs",
    target: "Docs",
    glyph: "📜",
  },
];

/** Build the runtime links that depend on the connected chain (explorer, bridge). */
export function chainLinks(explorerUrl: string): EcosystemLink[] {
  return [
    {
      name: "Via Explorer",
      blurb: "Inspect transactions, blocks, and accounts on this Rome chain.",
      url: explorerUrl,
      kind: "explorer",
      target: "Explorer",
      glyph: "🔎",
    },
    {
      name: "Bridge USDC in",
      blurb: "No faucet — bridge USDC gas into Rome from a source chain to get started.",
      url: "https://docs.rome.builders",
      kind: "bridge",
      target: "Docs",
      glyph: "🌉",
    },
  ];
}
