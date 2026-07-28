// The unified asset model. On Rome an SPL token and its ERC-20 are the SAME
// underlying account, so a user's holding of (say) USDC is one figure that shows
// up on both lanes. This module reads real on-chain balances for every registry
// token across whichever lanes are connected, and folds them into one list.
import { createPublicClient, http, erc20Abi, type Hex } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { getPrices } from "./prices.js";
import type { RomeConfig } from "./config.js";

/** A registry token, projected into the browser bundle by scripts/gen-config.ts. */
export interface TokenMeta {
  address: Hex; // the ERC-20 address on Rome (0xeee…eee for the native gas token)
  mintId: string; // the underlying Solana SPL mint
  symbol: string;
  name: string;
  decimals: number;
  kind: "gas" | "spl_wrapper" | string;
}

/** A bridge source chain (projected from @rome-protocol/registry bridge.json). */
export interface BridgeSource {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
  nativeSymbol?: string;
  /** Circle USDC address on this source chain (for reading the user's balance). */
  usdc?: Hex;
}

/** The full browser config — RomeConfig plus the projected catalog + deployments. */
export interface PathConfig extends RomeConfig {
  chainName: string;
  network: string;
  tokens: TokenMeta[];
  vault: Hex | null;
  smartAccount: Hex | null;
  bridgeSources: BridgeSource[];
}

/** Native SOL mint — a wallet's SOL is lamports, not an SPL token account. */
const WSOL_MINT = "So11111111111111111111111111111111111111112";
/** The conventional native-token sentinel address for the gas token. */
const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export interface AssetBalance {
  symbol: string;
  name: string;
  decimals: number;
  kind: string;
  evmAddress: Hex;
  mintId: string;
  /** Human amount from the EVM lane (MetaMask EOA), 0 when that lane is absent. */
  evmAmount: number;
  /** Human amount from the Solana lane (Phantom wallet), 0 when that lane is absent. */
  solAmount: number;
  /** Combined human amount across connected lanes. */
  amount: number;
  priceUsd: number | null;
  usdValue: number | null;
  /** Optional 24h price change % (populated in demo mode; undefined on-chain). */
  change24h?: number;
}

export interface Portfolio {
  assets: AssetBalance[];
  totalUsd: number;
  hasUnpriced: boolean;
}

export interface LaneAddresses {
  evm?: Hex;
  solana?: PublicKey;
}

function evmClient(cfg: RomeConfig) {
  return createPublicClient({ transport: http(cfg.proxyUrl) });
}

const toHuman = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

/** Read an ERC-20 balance on an arbitrary EVM chain as a human number. Never throws. */
export async function readErc20Human(rpcUrl: string, token: Hex, owner: Hex, decimals = 6): Promise<number> {
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const bal = (await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] })) as bigint;
    return toHuman(bal, decimals);
  } catch {
    return 0;
  }
}

/** EVM-lane balance for one token at `who`. Native gas via getBalance, else ERC-20. */
async function readEvmBalance(cfg: RomeConfig, token: TokenMeta, who: Hex): Promise<number> {
  const client = evmClient(cfg);
  try {
    if (token.kind === "gas" || token.address.toLowerCase() === NATIVE_SENTINEL) {
      const wei = await client.getBalance({ address: who });
      return toHuman(wei, token.decimals);
    }
    const bal = (await client.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [who],
    })) as bigint;
    return toHuman(bal, token.decimals);
  } catch {
    return 0;
  }
}

/** Solana-lane balance for one token at `owner`. Native SOL via getBalance, else SPL. */
async function readSolanaBalance(conn: Connection, token: TokenMeta, owner: PublicKey): Promise<number> {
  try {
    if (token.mintId === WSOL_MINT) {
      const lamports = await conn.getBalance(owner);
      return lamports / 1e9;
    }
    const accounts = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(token.mintId) });
    return accounts.value.reduce((sum, a) => sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Read the unified portfolio across connected lanes. Every token is read on both
 * lanes in parallel; missing lanes contribute 0. Prices are best-effort (stables
 * pinned to $1, volatile fetched live, unknown left as null → the UI shows "—").
 */
export async function readPortfolio(cfg: PathConfig, addrs: LaneAddresses): Promise<Portfolio> {
  const conn = addrs.solana ? new Connection(cfg.solanaRpc, "confirmed") : null;

  const rows = await Promise.all(
    cfg.tokens.map(async (token): Promise<AssetBalance> => {
      const [evmAmount, solAmount] = await Promise.all([
        addrs.evm ? readEvmBalance(cfg, token, addrs.evm) : Promise.resolve(0),
        conn && addrs.solana ? readSolanaBalance(conn, token, addrs.solana) : Promise.resolve(0),
      ]);
      return {
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        kind: token.kind,
        evmAddress: token.address,
        mintId: token.mintId,
        evmAmount,
        solAmount,
        amount: evmAmount + solAmount,
        priceUsd: null,
        usdValue: null,
      };
    }),
  );

  const prices = await getPrices([...new Set(rows.map((r) => r.symbol))]);
  let totalUsd = 0;
  let hasUnpriced = false;
  for (const r of rows) {
    r.priceUsd = prices[r.symbol] ?? null;
    if (r.priceUsd != null) {
      r.usdValue = r.amount * r.priceUsd;
      totalUsd += r.usdValue;
    } else if (r.amount > 0) {
      hasUnpriced = true;
    }
  }

  // Sort by USD value desc, then by held amount, then alphabetically.
  rows.sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || b.amount - a.amount || a.symbol.localeCompare(b.symbol));
  return { assets: rows, totalUsd, hasUnpriced };
}
