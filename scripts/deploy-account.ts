// Deploy the modular SmartAccount (contracts/SmartAccount.sol) with the EVM
// key's address as the first owner. A Solana user can later be added as a second
// owner (their synthetic address) via addOwner — one account, both lanes.
//
//   npm run deploy:account   → prints the address; set SMART_ACCOUNT_ADDRESS in .env
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import solc from "solc";
import { createWalletClient, createPublicClient, http, type Account } from "viem";
import { loadConfig, type RomeConfig } from "../lib/config.js";
import { requireEvmKey } from "../lib/keys.js";
import { romeChain } from "./deploy.js";

/** Compile contracts/SmartAccount.sol with solc. */
export function compileSmartAccount() {
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "SmartAccount.sol": { content: readFileSync(new URL("../contracts/SmartAccount.sol", import.meta.url), "utf8") } },
        settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
      }),
    ),
  );
  if (out.errors?.some((e: any) => e.severity === "error")) throw new Error("solc: " + JSON.stringify(out.errors));
  const c = out.contracts["SmartAccount.sol"].SmartAccount;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` as `0x${string}` };
}

/** Deploy SmartAccount(initialOwner) from an EVM account with USDC gas. */
export async function deploySmartAccount(cfg: RomeConfig, account: Account, initialOwner: `0x${string}`): Promise<`0x${string}`> {
  const { abi, bytecode } = compileSmartAccount();
  const chain = romeChain(cfg);
  const pub = createPublicClient({ chain, transport: http(cfg.proxyUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(cfg.proxyUrl) });
  const gp = await pub.getGasPrice();
  const hash = await wallet.deployContract({
    abi,
    bytecode,
    args: [initialOwner],
    gas: 26_000_000n,
    maxFeePerGas: (gp * 3n) / 2n,
    maxPriorityFeePerGas: 0n,
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success" || !rcpt.contractAddress) throw new Error("SmartAccount deploy failed");
  return rcpt.contractAddress;
}

// `npm run deploy:account`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig({ chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined, proxyUrl: process.env.PROXY_URL, solanaRpc: process.env.SOLANA_RPC });
  const account = requireEvmKey();
  const addr = await deploySmartAccount(cfg, account, account.address);
  console.log("SmartAccount deployed:", addr);
  console.log(`→ set SMART_ACCOUNT_ADDRESS=${addr} in .env  (owner: ${account.address})`);
}
