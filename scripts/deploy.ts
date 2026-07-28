import "dotenv/config";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import solc from "solc";
import { createWalletClient, createPublicClient, http, type Account } from "viem";
import { loadConfig, type RomeConfig } from "../lib/config.js";
import { requireEvmKey } from "../lib/keys.js";

/** Compile contracts/Vault.sol with solc. */
export function compileVault() {
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "Vault.sol": { content: readFileSync(new URL("../contracts/Vault.sol", import.meta.url), "utf8") } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  if (out.errors?.some((e: any) => e.severity === "error")) throw new Error("solc: " + JSON.stringify(out.errors));
  const c = out.contracts["Vault.sol"].Vault;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` as `0x${string}` };
}

/** A minimal viem chain object for a Rome chain (native currency = USDC, 18-dec). */
export function romeChain(cfg: RomeConfig) {
  return { id: cfg.chainId, name: "Rome", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [cfg.proxyUrl] } } } as const;
}

/** Deploy the Vault against the wUSDC wrapper, from an EVM account with USDC gas. */
export async function deployVault(cfg: RomeConfig, account: Account): Promise<`0x${string}`> {
  const { abi, bytecode } = compileVault();
  const chain = romeChain(cfg);
  const pub = createPublicClient({ chain, transport: http(cfg.proxyUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(cfg.proxyUrl) });
  const gp = await pub.getGasPrice();
  // Rome deploys are gas-heavy (Solana account creation is priced into gas).
  const hash = await wallet.deployContract({ abi, bytecode, args: [cfg.wusdc], gas: 26_000_000n, maxFeePerGas: (gp * 3n) / 2n, maxPriorityFeePerGas: 0n });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success" || !rcpt.contractAddress) throw new Error("Vault deploy failed");
  return rcpt.contractAddress;
}

// `npm run deploy` — cross-platform entry check (Windows paths need pathToFileURL).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig({ chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined, proxyUrl: process.env.PROXY_URL, solanaRpc: process.env.SOLANA_RPC });
  const account = requireEvmKey();
  const vault = await deployVault(cfg, account);
  console.log("Vault deployed:", vault);
  console.log(`→ set VAULT_ADDRESS=${vault} in .env`);
}
