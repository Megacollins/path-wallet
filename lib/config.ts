import { getChain, getTokens } from "@rome-protocol/registry";
import type { Hex } from "viem";

/** Everything the two lanes need — resolved from @rome-protocol/registry, no hardcoding. */
export interface RomeConfig {
  chainId: number;
  proxyUrl: string; // EVM JSON-RPC + rome_emulateCallAccounts
  solanaRpc: string; // Solana RPC (the Solana lane submits + confirms here)
  programId: string; // rome-evm program id
  wusdc: Hex; // the ERC20SPL wrapper — the token both lanes spend
  usdcMint: string; // the underlying Circle USDC SPL mint (Solana side)
  explorerUrl: string;
}

/** Rome Hadrian (devnet) — the default chain. */
export const DEFAULT_CHAIN_ID = 200010;

/**
 * Resolve config for a chain from the public registry. Pass overrides (e.g. a
 * private Solana RPC, or a different chainId) — the app reads them from Vite env,
 * the scripts from process.env, so this stays environment-agnostic.
 */
export function loadConfig(overrides: { chainId?: number; proxyUrl?: string; solanaRpc?: string } = {}): RomeConfig {
  const chainId = overrides.chainId ?? DEFAULT_CHAIN_ID;
  const chain = getChain(chainId);
  if (!chain) throw new Error(`chain ${chainId} not found in @rome-protocol/registry`);
  // The gas token (kind "gas") names the USDC mint; wUSDC is the spl_wrapper over that same mint.
  const tokens = getTokens(chainId) ?? [];
  const gas = tokens.find((t: any) => t.kind === "gas");
  const usdc = tokens.find((t: any) => t.kind === "spl_wrapper" && t.mintId === gas?.mintId);
  if (!usdc) throw new Error(`no wUSDC wrapper (spl_wrapper over the gas-token mint) for chain ${chainId} in the registry`);
  return {
    chainId,
    proxyUrl: overrides.proxyUrl || chain.rpcUrl,
    solanaRpc: overrides.solanaRpc || chain.solana.rpc,
    programId: chain.romeEvmProgramId,
    wusdc: usdc.address as Hex,
    usdcMint: usdc.mintId,
    explorerUrl: chain.explorerUrl,
  };
}
