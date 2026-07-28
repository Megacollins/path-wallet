// Path starter-gas faucet server. Holds the TREASURY key (ROME_FAUCET_KEY) and
// drips a small amount of USDC gas to claimants, with anti-abuse. Self-host it
// anywhere Node runs (Railway/Render/Fly/a VPS) or adapt the handler to a
// serverless function. Run locally: `npm run faucet`.
//
// The treasury key is read ONLY from the server environment and never sent to
// the browser. Fund the treasury with bridged USDC before running (see FAUCET.md).
import "dotenv/config";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../lib/config.js";
import { dispenseStarterGas } from "../lib/faucet.js";

/* ------------------------------------------------------------------ config */
const cfg = loadConfig({ chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined, proxyUrl: process.env.PROXY_URL, solanaRpc: process.env.SOLANA_RPC });

const rawKey = process.env.ROME_FAUCET_KEY?.trim();
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  console.error("ROME_FAUCET_KEY is missing/invalid. Set it to a 0x 32-byte EVM key funded with USDC on Rome (the faucet treasury). See FAUCET.md.");
  process.exit(1);
}
const treasury = privateKeyToAccount(rawKey as `0x${string}`);

const AMOUNT_USDC = Number(process.env.FAUCET_AMOUNT_USDC ?? "0.75");
const MAX_RECIPIENT_USDC = Number(process.env.FAUCET_MAX_RECIPIENT_USDC ?? "0.2");
const COOLDOWN_MS = Number(process.env.FAUCET_COOLDOWN_HOURS ?? "24") * 3600_000;
const MAX_PER_IP_HOUR = Number(process.env.FAUCET_MAX_PER_IP_HOUR ?? "3");
const MAX_DAILY = Number(process.env.FAUCET_MAX_DAILY ?? "300");
const PORT = Number(process.env.FAUCET_PORT ?? "8787");
const ALLOW_ORIGIN = process.env.FAUCET_ALLOW_ORIGIN ?? "*";

/* --------------------------------------------------------- persisted state */
const STATE_FILE = fileURLToPath(new URL("./.faucet-state.json", import.meta.url));
interface State { byAddress: Record<string, number>; byIpHour: Record<string, { h: number; n: number }>; day: string; dailyCount: number }
const state: State = load();
function load(): State {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch { /* start fresh */ }
  return { byAddress: {}, byIpHour: {}, day: today(), dailyCount: 0 };
}
function save() {
  try { writeFileSync(STATE_FILE, JSON.stringify(state)); } catch { /* best effort */ }
}
function today() { return new Date().toISOString().slice(0, 10); }

/* ------------------------------------------------------------ rate limiting */
function rollDay() {
  const d = today();
  if (state.day !== d) { state.day = d; state.dailyCount = 0; state.byIpHour = {}; }
}
/** Returns an error string if blocked, else null. */
function checkLimits(address: string, ip: string): string | null {
  rollDay();
  const addr = address.toLowerCase();
  const now = Date.now();
  const last = state.byAddress[addr];
  if (last && now - last < COOLDOWN_MS) {
    const hrs = Math.ceil((COOLDOWN_MS - (now - last)) / 3600_000);
    return `You've already claimed. Try again in ~${hrs}h.`;
  }
  const hour = Math.floor(now / 3600_000);
  const ipRec = state.byIpHour[ip];
  if (ipRec && ipRec.h === hour && ipRec.n >= MAX_PER_IP_HOUR) return "Too many claims from your network this hour. Try later.";
  if (state.dailyCount >= MAX_DAILY) return "The faucet has reached its daily limit. Try again tomorrow.";
  return null;
}
function recordClaim(address: string, ip: string) {
  const now = Date.now();
  const hour = Math.floor(now / 3600_000);
  state.byAddress[address.toLowerCase()] = now;
  const ipRec = state.byIpHour[ip];
  state.byIpHour[ip] = ipRec && ipRec.h === hour ? { h: hour, n: ipRec.n + 1 } : { h: hour, n: 1 };
  state.dailyCount += 1;
  save();
}

/* -------------------------------------------------------------- http server */
function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}
function json(res: http.ServerResponse, code: number, body: unknown) {
  cors(res);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, treasury: treasury.address, chainId: cfg.chainId, amountUsdc: AMOUNT_USDC });
  if (req.method !== "POST" || !req.url?.startsWith("/api/faucet")) return json(res, 404, { ok: false, error: "Not found" });

  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 2000) req.destroy(); });
  req.on("end", async () => {
    try {
      const { address } = JSON.parse(raw || "{}");
      const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress || "?").trim();
      if (typeof address !== "string") return json(res, 400, { ok: false, error: "Provide an address." });

      const blocked = checkLimits(address, ip);
      if (blocked) return json(res, 429, { ok: false, error: blocked });

      const result = await dispenseStarterGas(cfg, treasury, address, { amountUsdc: AMOUNT_USDC, maxRecipientUsdc: MAX_RECIPIENT_USDC });
      if (!result.ok) return json(res, 400, result);

      recordClaim(address, ip);
      const explorer = cfg.explorerUrl ? `${cfg.explorerUrl.replace(/\/$/, "")}/tx/${result.txHash}` : undefined;
      return json(res, 200, { ...result, explorer });
    } catch (e: any) {
      console.error("faucet error:", e?.message ?? e);
      return json(res, 500, { ok: false, error: "Faucet failed to send. Please try again." });
    }
  });
});

server.listen(PORT, () => {
  console.log(`⛲ Path faucet on :${PORT}  · chain ${cfg.chainId} · treasury ${treasury.address} · drip ${AMOUNT_USDC} USDC`);
  console.log(`   POST http://localhost:${PORT}/api/faucet  { "address": "0x…" }`);
});
