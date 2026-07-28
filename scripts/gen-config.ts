// Project the registry config to a static JSON the browser bundle can import
// (@rome-protocol/registry reads the filesystem, so it can't run in the browser).
// Runs before `dev` / `build`. Reads .env overrides + the deployed VAULT_ADDRESS.
//
// Path extends the scaffold's config with the full token catalog + chain name so
// the unified portfolio can enumerate assets without hardcoding a single address.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getChain, getTokens, getBridge } from "@rome-protocol/registry";
import { loadConfig } from "../lib/config.js";
import type { BridgeSource, TokenMeta } from "../lib/assets.js";

const KNOWN_NATIVE: Record<number, string> = { 80002: "POL", 43113: "AVAX", 10143: "MON" };
// Circle testnet USDC per source chain (canonical; also in registry bridge.json assets).
const KNOWN_USDC: Record<number, `0x${string}`> = {
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  80002: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", // Polygon Amoy
  43113: "0x5425890298aed601595a70AB815c96711a31Bc65", // Avalanche Fuji
  10143: "0x534b2f3A21130d7a60830c2Df862319e593943A3", // Monad Testnet
};

const chainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined;
const cfg = loadConfig({ chainId, proxyUrl: process.env.PROXY_URL, solanaRpc: process.env.SOLANA_RPC });

const chain = getChain(cfg.chainId);
const tokens: TokenMeta[] = (getTokens(cfg.chainId) ?? []).map((t: any) => ({
  address: t.address,
  mintId: t.mintId,
  symbol: t.symbol,
  name: t.name,
  decimals: t.decimals,
  kind: t.kind,
}));

// Bridge source chains (for the in-app "Bridge USDC in" panel).
const bridge = getBridge(cfg.chainId) as any;
const rawSources = [bridge?.sourceEvm, ...(bridge?.sourceEvms ?? [])].filter(Boolean);
const seen = new Set<number>();
const bridgeSources: BridgeSource[] = [];
for (const s of rawSources) {
  if (!s?.chainId || seen.has(s.chainId)) continue;
  seen.add(s.chainId);
  bridgeSources.push({ chainId: s.chainId, name: s.name, rpcUrl: s.rpcUrl, explorerUrl: s.explorerUrl, nativeSymbol: KNOWN_NATIVE[s.chainId] ?? "ETH", usdc: KNOWN_USDC[s.chainId] });
}

const out = {
  ...cfg,
  chainName: chain?.name ?? `Rome ${cfg.chainId}`,
  network: chain?.network ?? "devnet",
  tokens,
  vault: (process.env.VAULT_ADDRESS || null) as string | null,
  smartAccount: (process.env.SMART_ACCOUNT_ADDRESS || null) as string | null,
  bridgeSources,
};

writeFileSync(new URL("../src/config.generated.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(
  "wrote src/config.generated.json —",
  `${out.chainName} (${out.chainId})`,
  `· ${tokens.length} tokens · ${bridgeSources.length} bridge sources`,
  out.vault ? `· vault ${out.vault}` : "· (deploy a Vault, then set VAULT_ADDRESS)",
);
