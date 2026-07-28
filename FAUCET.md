# Path starter-gas faucet

One-click "get gas" onboarding for Path. Rome has **no public faucet** (gas is real
USDC), so Path runs **its own**: a small backend holds a funded treasury wallet and
drips a little USDC to new users, with anti-abuse. The user just clicks **Claim
starter gas** on the dashboard.

```
[Claim starter gas]  →  POST /api/faucet {address}  →  faucet server
      (browser)                                          holds ROME_FAUCET_KEY
                                                          ├─ rate-limit / low-balance gate
                                                          └─ submitRomeTx: treasury → user (USDC)
                                                     ← { txHash, explorer }
```

The treasury key lives **only** on the server (env var) — it is never sent to or
readable by the browser.

## Pieces
- `lib/faucet.ts` — the send + gating logic (`dispenseStarterGas`).
- `server/faucet-server.ts` — HTTP server, anti-abuse, treasury key. Run with `npm run faucet`.
- `src/components/FaucetButton.tsx` — the `Claim starter gas` banner (on the dashboard when a real EVM wallet is connected).

## Setup

### 1. Create + fund a treasury wallet
Make a fresh EVM key for the faucet and **bridge USDC into it on Rome** (this is the
pool you hand out). See the main README / `docs.rome.builders`:
```bash
rome fund hadrian --from sepolia --amount 25   # fund the treasury with test-USDC
```

### 2. Configure `.env` (server side)
```bash
ROME_FAUCET_KEY=0x<treasury private key>   # NEVER commit this
FAUCET_AMOUNT_USDC=0.75                     # per-claim drip
FAUCET_MAX_RECIPIENT_USDC=0.2               # only fund wallets below this
FAUCET_COOLDOWN_HOURS=24                    # per-address
FAUCET_MAX_PER_IP_HOUR=3
FAUCET_MAX_DAILY=300                        # global treasury guard
FAUCET_PORT=8787
FAUCET_ALLOW_ORIGIN=https://your-path-domain.app   # lock to your app in prod
```

### 3. Run it
```bash
npm run faucet
# ⛲ Path faucet on :8787 · chain 200010 · treasury 0x… · drip 0.75 USDC
```

### 4. Point the frontend at it
```bash
# .env (frontend) — Vite exposes VITE_* to the browser
VITE_FAUCET_URL=https://your-faucet-host/api/faucet
```
Then `npm run dev` / `npm run build`. The **Claim starter gas** banner appears on the
dashboard whenever a real MetaMask wallet is connected (hidden in Demo mode).

## Anti-abuse (built in)
- **Low-balance gate** — won't top up a wallet that already has gas.
- **Per-address cooldown** (`FAUCET_COOLDOWN_HOURS`).
- **Per-IP hourly cap** + **global daily cap** (protects the treasury).
- **Treasury solvency check** before every send.

State persists to `server/.faucet-state.json` (git-ignored). For a multi-instance
deploy, swap that file for a shared store (Upstash/Vercel KV/Redis) — the logic in
`faucet-server.ts` is small and easy to repoint.

## Deploying
The server is plain Node — host it on Railway, Render, Fly, or a VPS, or adapt the
`/api/faucet` handler into a Vercel/Netlify/Cloudflare function. Set the same env
vars there, and set `VITE_FAUCET_URL` on the frontend to its URL.

## ⚠️ Testnet vs mainnet
- **Testnet (Hadrian/Martius):** the drip is test-USDC — cheap, safe, ideal for launch.
- **Mainnet:** every claim is **real money**. A free faucet will be drained by bots.
  There, prefer **sponsored gas** (a relayer covers only the user's first N txs, capped)
  or a **fiat on-ramp**, and keep the caps tight. Don't point this at a mainnet treasury
  without hardening (captcha, per-wallet allowlists, small caps).
