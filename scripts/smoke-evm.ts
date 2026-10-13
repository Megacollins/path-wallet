// Live testnet smoke test of the MetaMask lane on the NEW wrapped tokens, using the same library functions the app
// calls. A brand-new wallet (never granted anything) is funded with gas from the project's dev wallet, then walks the
// whole journey: enable (one-time grant) → wrap gas into wUSDC → approve the Vault → deposit → withdraw → send wUSDC.
// Costs roughly 0.15 testnet USDC of gas (leftovers are swept back to the dev wallet). Needs ROME_EVM_KEY (funded) and VAULT_ADDRESS in .env.
//   npm run smoke:evm
import "dotenv/config";
import { createPublicClient, formatUnits, http, parseAbi, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../lib/config.js";
import { eip1193FromAccount } from "../lib/eip1193Node.js";
import { requireEvmKey } from "../lib/keys.js";
import * as rome from "../lib/rome.js";

const cfg = loadConfig({ chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined });
const vault = process.env.VAULT_ADDRESS as `0x${string}` | undefined;
if (!vault) throw new Error("VAULT_ADDRESS is not set in .env");

const funder = requireEvmKey();
const fresh = privateKeyToAccount(generatePrivateKey());
const funderProvider = eip1193FromAccount(funder, cfg.proxyUrl, cfg.chainId);
const provider = eip1193FromAccount(fresh, cfg.proxyUrl, cfg.chainId);
const pub = createPublicClient({ transport: http(cfg.proxyUrl) });

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  → " + String(detail)}`);
  if (!ok) failures++;
};
const step = async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await fn();
  } catch (e: any) {
    check(name, false, String(e?.shortMessage ?? e?.message ?? e).slice(0, 260));
    return undefined;
  }
};
const w6 = (x: bigint) => formatUnits(x, 6);

console.log(`chain ${cfg.chainId} | wUSDC ${cfg.wusdc} | vault ${vault}\nfresh wallet ${fresh.address} (funded by the dev wallet)\n`);

await step("fund the fresh wallet with gas", async () => {
  await rome.evmSendNative(funderProvider, funder.address, fresh.address, parseUnits("0.8", 18));
  const bal = await pub.getBalance({ address: fresh.address });
  check("fresh wallet received 0.8 USDC of gas", bal >= parseUnits("0.79", 18), formatUnits(bal, 18));
});

const s0 = await rome.wrapperState(cfg, fresh.address);
check("a never-granted wallet reads as needs_grant (not legacy, not ready)", s0 === "needs_grant", s0);
check("the old wrapper is classified legacy", (await rome.wrapperState(cfg, fresh.address, "0xd4cc34b67c805d472b5a709a22a1037f6b16ef28")) === "legacy");
const vaultToken = (await pub.readContract({ address: vault, abi: parseAbi(["function token() view returns (address)"]), functionName: "token" })) as string;
check("the Vault is bound to the wrapper the app uses (not the old one)", vaultToken.toLowerCase() === cfg.wusdc.toLowerCase(), `${vaultToken} vs ${cfg.wusdc}`);

// Order matters: the grant needs the wallet's wUSDC token account to exist, and wrapping is what creates it.
await step("wrap 0.3 gas USDC into wUSDC", async () => {
  await rome.evmWrapToWusdc(provider, fresh.address, parseUnits("0.3", 18));
  check("wUSDC balance is 0.3", (await rome.wusdcBalanceOf(cfg, fresh.address)) === 300_000n, w6(await rome.wusdcBalanceOf(cfg, fresh.address)));
});

await step("enable wUSDC (the one-time grant)", async () => {
  await rome.grantWrapper(provider, fresh.address, cfg);
  check("after the grant the wallet is ready", (await rome.wrapperState(cfg, fresh.address)) === "ready");
});

await step("approve the Vault, then deposit 0.2 wUSDC", async () => {
  await rome.evmApprove(provider, fresh.address, cfg, vault, 200_000n);
  await rome.evmDeposit(provider, fresh.address, vault, 200_000n);
  const inVault = await rome.vaultBalanceOf(cfg, vault, fresh.address);
  const wallet = await rome.wusdcBalanceOf(cfg, fresh.address);
  check("Vault credits the deposit (0.2)", inVault === 200_000n, w6(inVault));
  check("wallet wUSDC dropped to 0.1", wallet === 100_000n, w6(wallet));
});

await step("withdraw 0.2 wUSDC from the Vault", async () => {
  await rome.evmWithdraw(provider, fresh.address, vault, 200_000n);
  const inVault = await rome.vaultBalanceOf(cfg, vault, fresh.address);
  const wallet = await rome.wusdcBalanceOf(cfg, fresh.address);
  check("Vault balance back to 0", inVault === 0n, w6(inVault));
  check("wallet wUSDC back to 0.3", wallet === 300_000n, w6(wallet));
});

await step("send 0.05 wUSDC to another wallet", async () => {
  const before = await rome.wusdcBalanceOf(cfg, funder.address);
  await rome.evmSendErc20(provider, fresh.address, cfg.wusdc, funder.address, 50_000n);
  const after = await rome.wusdcBalanceOf(cfg, funder.address);
  check("recipient gained 0.05", after - before === 50_000n, w6(after - before));
  check("sender holds 0.25", (await rome.wusdcBalanceOf(cfg, fresh.address)) === 250_000n);
});

// Give the leftovers back so repeated runs don't drain the dev wallet (best effort).
await step("return the leftovers to the dev wallet", async () => {
  const left = await rome.wusdcBalanceOf(cfg, fresh.address);
  if (left > 0n) await rome.evmSendErc20(provider, fresh.address, cfg.wusdc, funder.address, left);
  const gas = await pub.getBalance({ address: fresh.address });
  const keep = parseUnits("0.06", 18); // enough for the final transfer's fee
  if (gas > keep) await rome.evmSendNative(provider, fresh.address, funder.address, gas - keep);
  check("leftover wUSDC returned", (await rome.wusdcBalanceOf(cfg, fresh.address)) === 0n);
});

const total = await pub.readContract({ address: vault, abi: rome.VAULT_ABI, functionName: "totalDeposits" });
check("Vault totalDeposits is 0 again (nothing stuck)", total === 0n, total);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
