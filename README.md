<div align="center">

# ⟡ Path

**A dual-lane unified smart wallet on [Rome Protocol](https://docs.rome.builders).**
One state, two lanes — a **MetaMask (EVM)** user and a **Phantom (Solana)** user drive the same accounts, the same tokens, and the same contracts.

</div>

---

## What is this?

Rome Protocol runs **EVM chains natively inside the Solana runtime**. A single chain has one shared state that two lanes reach:

- **EVM lane** — MetaMask signs, submitted via `submitRomeTx` from `@rome-protocol/sdk`.
- **Solana lane** — Phantom signs (no EVM key), submitted via `submitRomeTxSolanaLane`. The user's EVM identity is their **synthetic address** (`keccak256(pubkey)[12:]`).

Because an SPL token **is** its ERC-20 (the same underlying account), Path can show one unified portfolio and let either wallet act on it. Path is built on Rome's official `create-rome-app` scaffold and follows Rome's patterns exactly: **every write goes through the SDK**, and nothing is hardcoded — chain ids, RPC URLs, and token addresses all come from `@rome-protocol/registry`.

## Features (MVP)

| | |
|---|---|
| 🔗 **Dual wallet connection** | MetaMask + Phantom connected **simultaneously**. EVM discovery uses EIP-6963 so it binds to MetaMask specifically even when Phantom also injects an EVM provider. |
| 📊 **Unified portfolio** | Total balance + per-token balances (USDC, wUSDC, wETH, wSOL…) read live across **both lanes** and folded into one list. Stable prices pinned to $1, volatile prices best-effort (never fabricated). |
| ➤ **Send / transfer** | Send any token on the EVM lane; send wUSDC on the Solana lane (fund → transfer through the synthetic). |
| 🏦 **Vault** | Dual-lane deposit / withdraw into one shared `Vault` — the clearest proof of Rome's single state. |
| 🏛️ **Ecosystem** | Quick-action cards to real Rome apps (Rome DEX, Cardo, Aave, Aerarium, Compound) and the live explorer. |
| ⚙️ **Settings** | Registry-sourced network facts, connected lanes, token catalog, and SmartAccount status. |
| 🧱 **Modular SmartAccount** | A Solidity smart account owned by **both** an EVM EOA and a Solana synthetic address, with a module system for future session keys, recovery, and spend limits. |

Fully responsive, mobile-first: bottom nav on phones, a slide-in drawer on tablets, a persistent sidebar on desktop — 320px to 4K.

## The dual-lane architecture

```
                       ┌──────────────────────────────┐
   MetaMask (EVM EOA)  │                              │
        │  submitRomeTx │        Rome EVM chain        │
        ▼──────────────▶│   (executes inside Solana)   │
                        │                              │
                        │   ┌────────┐   ┌──────────┐  │
                        │   │ Vault  │   │  Smart-  │  │   ONE shared state
        ▲──────────────▶│   │        │   │ Account  │  │   • SPL == ERC-20
        │ submitRome     │   └────────┘   └──────────┘  │   • no bridge/sync
        │  TxSolanaLane  │                              │
   Phantom (Solana key) │   synthetic address = the    │
   → synthetic address  │   Phantom user's EVM identity│
                        └──────────────────────────────┘
```

- **EVM lane** (`lib/rome.ts` → `evm*`): MetaMask has native USDC gas. Path wraps gas into the wUSDC ERC-20, then `approve`/`deposit`/`transfer` — each via `submitRomeTx`.
- **Solana lane** (`lib/rome.ts` → `solana*`): Phantom funds its synthetic (`buildFundLeg`), acts via `submitRomeTxSolanaLane` (which handles account discovery, ComputeBudget, the treasure wallet, and auto-provisioning), and sweeps back so the synthetic holds nothing at rest.

Reads stay vanilla (`viem` / `@solana/web3.js`). Only **writes** go through the SDK — this is a hard Rome rule, not a preference.

## Tech stack

- **Frontend** — Vite + React 18 + TypeScript, Tailwind CSS, Framer Motion, React Router, `viem`, `@solana/wallet-adapter-react`, `@rome-protocol/sdk`.
- **Contracts** — Solidity `^0.8.28`, compiled with `solc`, deployed with `viem`.
- **Config** — `@rome-protocol/registry`, projected into the browser bundle by `scripts/gen-config.ts`.

> **Why Vite, not Next.js?** Rome's official scaffold and the SDK are proven on Vite + React, and the dual-lane flow is entirely client-side (wallet injection, synthetic addresses, the GitHub-installed SDK). This keeps "the transactions actually work" as the top priority. Everything else in a typical Next.js brief (Tailwind, Framer Motion, wagmi/viem, wallet-adapter) is here regardless.

## Getting started

### 1. Install

```bash
npm install
```

The Rome packages install from GitHub (not npm): `@rome-protocol/sdk` and `@rome-protocol/registry` are pinned in `package.json`.

### 2. Configure `.env`

`.env` is seeded from `.env.example` on scaffold. You only need keys to run the **scripts** (deploy/demo) — the web app reads balances with no keys until a wallet connects.

| Variable | Required for | Notes |
|---|---|---|
| `CHAIN_ID` | optional | Defaults to **Hadrian** `200010`. Set to **Martius** `121214` for testnet. |
| `PROXY_URL` / `SOLANA_RPC` | optional | Override only for a private RPC; otherwise resolved from the registry. |
| `ROME_EVM_KEY` | scripts | `0x`-prefixed 32-byte EVM key, funded with ≥ 1 USDC gas on Rome. |
| `ROME_SOLANA_KEY` | scripts | Phantom/`solana-keygen` JSON secret-key array (64 numbers), ≥ 0.6 USDC + 0.02 SOL. |
| `VAULT_ADDRESS` | Vault page | Set after `npm run deploy`. |
| `SMART_ACCOUNT_ADDRESS` | Settings page | Set after `npm run deploy:account` (optional). |

> **There is no faucet.** Rome's gas token is USDC — bridge it in from a source chain. Get testnet USDC on Sepolia/an L2/Solana, then bridge to Hadrian/Martius (`rome fund <chain> --from sepolia --amount 1`). See the [docs](https://docs.rome.builders).

### 3. Run the web app

```bash
npm run dev            # → http://localhost:5173  (regenerates config, then Vite)
```

Connect MetaMask and/or Phantom from the header. MetaMask is auto-prompted to add/switch to the Rome chain.

### 4. Deploy the contracts

```bash
npm run deploy         # deploy Vault → prints address; set VAULT_ADDRESS in .env
npm run deploy:account # deploy the modular SmartAccount (owner = your EVM key)
```

### 5. Prove it (headless)

```bash
npm run demo           # a MetaMask lane AND a Phantom lane each hit ONE Vault
npm run verify         # the rome CLI works-gate — same contract answers on both lanes
```

## Running on Hadrian vs Martius

Everything is registry-driven, so switching networks is one env var:

```bash
# Hadrian (devnet, default) — chain 200010
npm run dev

# Martius (testnet) — chain 121214
CHAIN_ID=121214 npm run dev
CHAIN_ID=121214 npm run deploy
```

## The SmartAccount contract

`contracts/SmartAccount.sol` is a modular account designed for continuous shipping:

- **Owned by both lanes** — an owner is any `address`; add your Phantom synthetic as a second owner (`addOwner`) so one account is driven from MetaMask **and** Phantom.
- **Modules** — `enableModule` / `disableModule` authorize contracts to `execute` on the account's behalf. The home for session keys, social recovery, gas abstraction, and agent mode.
- **Guard hook** — an optional `IAccountGuard.preExecute` is consulted before every call: a first-class place for spend limits and session-key scopes.
- **Batched execution** — `executeBatch` runs calls atomically.

Deploy with `npm run deploy:account`. Add owners / modules through `submitRomeTx` (EVM lane) or `submitRomeTxSolanaLane` (Solana lane) — the same account, either wallet.

## Project structure

```
path-wallet/
├── contracts/
│   ├── Vault.sol            # shared dual-lane vault (from the scaffold)
│   └── SmartAccount.sol     # modular smart account (EVM EOA + Solana synthetic)
├── lib/                     # environment-agnostic core (used by app + scripts)
│   ├── rome.ts              # the dual-lane write core: submitRomeTx / …SolanaLane
│   ├── assets.ts            # unified portfolio model + on-chain readers
│   ├── prices.ts            # best-effort USD pricing (stables pinned, rest live)
│   ├── apps.ts              # verified Rome ecosystem links
│   └── config.ts / format.ts
├── scripts/                 # gen-config · deploy · deploy-account · demo · verify
├── src/
│   ├── wallet/              # EVM (EIP-6963) + Solana (wallet-adapter) + useWallets
│   ├── components/          # Logo, layout (responsive shell), ui, Toast, …
│   ├── pages/               # Dashboard · Send · Vault · Apps · Settings
│   └── config.ts            # typed access to the registry-projected config
└── tailwind.config.js       # the Strong Ancient Rome design tokens
```

## Design system — Strong Ancient Rome

Deep charcoal stone backgrounds, marble-textured cards with carved gold edges, muted gold (`#C9A227`) and terracotta accents, thin gold hairlines, classical serif (Cormorant Garamond) headings over a clean sans (Inter) for body and numbers. Framer Motion drives the micro-interactions. Luxurious, dramatic, timeless — fused with modern fintech clarity.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Regenerate config, start Vite. |
| `npm run build` | Typecheck + production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run deploy` | Deploy `Vault`. |
| `npm run deploy:account` | Deploy `SmartAccount`. |
| `npm run demo` | Headless dual-lane proof. |
| `npm run verify` | Rome CLI both-lane works-gate. |

## License

MIT. Built on Rome's official stack — see [docs.rome.builders](https://docs.rome.builders) and [github.com/rome-protocol](https://github.com/rome-protocol).
