// Project the registry config to a static JSON the browser bundle can import
// (@rome-protocol/registry reads the filesystem, so it can't run in the browser).
// Runs before `dev` / `build`. Reads .env overrides + the deployed VAULT_ADDRESS.
//
// Path extends the scaffold's config with the full token catalog + chain name so
// the unified portfolio can enumerate assets without hardcoding a single address —
// and projects EVERY live registry chain, so the app can offer a network switcher.
// The default chain (CHAIN_ID, else Rome Hadrian) comes first.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { listChains, getTokens, getBridge } from "@rome-protocol/registry";
import { DEFAULT_CHAIN_ID, loadConfig } from "../lib/config.js";
import type { BridgeSource, PathConfig, TokenMeta } from "../lib/assets.js";

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

// Source-chain RPCs the registry lists that no longer work. Polygon Amoy's
// `rpc-amoy.polygon.technology` has no DNS records any more (verified against
// Google DNS), so MetaMask couldn't add the chain and balances never loaded.
// Replaced with a public RPC that answers browsers (CORS) and has the USDC
// contract. Drop an entry once the registry itself is fixed.
const RPC_OVERRIDES: Record<number, string> = {
  80002: "https://polygon-amoy-bor-rpc.publicnode.com",
};

const defaultChainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : DEFAULT_CHAIN_ID;

/** A deployment address for one chain: VAULT_ADDRESS_<chainId>, or plain VAULT_ADDRESS for the default chain only. */
const deployed = (name: string, chainId: number): string | null =>
  process.env[`${name}_${chainId}`] || (chainId === defaultChainId ? process.env[name] : "") || null;

function project(chain: { chainId: number; name?: string; network?: string }): PathConfig {
  const isDefault = chain.chainId === defaultChainId;
  // PROXY_URL / SOLANA_RPC are operator overrides for the default chain only.
  const base = loadConfig({
    chainId: chain.chainId,
    proxyUrl: isDefault ? process.env.PROXY_URL : undefined,
    solanaRpc: isDefault ? process.env.SOLANA_RPC : undefined,
  });

  const tokens: TokenMeta[] = (getTokens(chain.chainId) ?? []).map((t: any) => ({
    address: t.address,
    mintId: t.mintId,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    kind: t.kind,
  }));

  // Bridge source chains (for the in-app "Bridge USDC in" panel).
  const bridge = getBridge(chain.chainId) as any;
  const rawSources = [bridge?.sourceEvm, ...(bridge?.sourceEvms ?? [])].filter(Boolean);
  const seen = new Set<number>();
  const bridgeSources: BridgeSource[] = [];
  for (const s of rawSources) {
    if (!s?.chainId || seen.has(s.chainId)) continue;
    seen.add(s.chainId);
    bridgeSources.push({ chainId: s.chainId, name: s.name, rpcUrl: RPC_OVERRIDES[s.chainId] ?? s.rpcUrl, explorerUrl: s.explorerUrl, nativeSymbol: KNOWN_NATIVE[s.chainId] ?? "ETH", usdc: KNOWN_USDC[s.chainId] });
  }

  return {
    ...base,
    chainName: chain.name ?? `Rome ${chain.chainId}`,
    network: chain.network ?? "devnet",
    tokens,
    vault: deployed("VAULT_ADDRESS", chain.chainId) as `0x${string}` | null,
    smartAccount: deployed("SMART_ACCOUNT_ADDRESS", chain.chainId) as `0x${string}` | null,
    bridgeSources,
  };
}

const networks: PathConfig[] = [];
for (const chain of listChains()) {
  if (chain.status && chain.status !== "live") continue;
  try {
    networks.push(project(chain));
  } catch (e) {
    // A chain without the shape Path needs (e.g. no wUSDC wrapper) is skipped, never fatal for the rest.
    console.warn(`skipped chain ${chain.chainId} (${chain.name}): ${(e as Error).message}`);
  }
}
if (!networks.some((n) => n.chainId === defaultChainId)) throw new Error(`default chain ${defaultChainId} is not a live chain in @rome-protocol/registry`);
networks.sort((a, b) => Number(b.chainId === defaultChainId) - Number(a.chainId === defaultChainId) || a.chainId - b.chainId);

writeFileSync(new URL("../src/config.generated.json", import.meta.url), JSON.stringify({ defaultChainId, networks }, null, 2) + "\n");
// The API (Vercel functions) needs a few of these facts too — RPC and Vault per chain. A function can't
// rely on this script having run first (Vercel builds functions and the static site independently), so
// the projection is a committed TypeScript module, refreshed here on every build. Public data only.
const indexed = networks.map((n) => ({ chainId: n.chainId, chainName: n.chainName, network: n.network, proxyUrl: n.proxyUrl, vault: n.vault, wusdc: n.wusdc }));
writeFileSync(
  new URL("../api/_lib/networks.generated.ts", import.meta.url),
  `// Generated by scripts/gen-config.ts from @rome-protocol/registry (+ deployed addresses). Committed on\n// purpose so API functions never depend on build order. Public data only. Do not edit by hand.\nexport interface IndexedNetwork {\n  chainId: number;\n  chainName: string;\n  network: string;\n  proxyUrl: string;\n  vault: string | null;\n  wusdc: string;\n}\nexport const NETWORKS: IndexedNetwork[] = ${JSON.stringify(indexed, null, 2)};\n`,
);
console.log(
  "wrote src/config.generated.json —",
  networks.map((n) => `${n.chainName} (${n.chainId}${n.chainId === defaultChainId ? ", default" : ""}) · ${n.tokens.length} tokens · ${n.bridgeSources.length} bridge sources${n.vault ? " · vault " + n.vault : ""}`).join("  |  "),
);
