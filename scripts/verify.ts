// `npm run verify` — the works-gate, straight from the scaffold. Loads .env
// (ROME_EVM_KEY / ROME_SOLANA_KEY) and runs the rome CLI's `verify` against this
// app's chain: the SAME contract must answer on BOTH lanes. Identical to running
// `rome verify <chain>` yourself with the keys exported — this just feeds it .env.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";

const cfg = loadConfig({ chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined });
const extra = process.argv.slice(2);
const args = ["-y", "github:rome-protocol/rome-cli", "verify", String(cfg.chainId)];
if (!extra.includes("--path")) args.push("--path", "solidity");
const r = spawnSync("npx", [...args, ...extra], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
