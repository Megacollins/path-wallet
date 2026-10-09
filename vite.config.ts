import { spawn } from "node:child_process";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// The Canton dApp SDK imports @walletconnect/sign-client unconditionally, for a
// WalletConnect transport Path doesn't offer. It's an *optional* peer, so it isn't
// installed for consumers — but once it resolves, the build bundles it (+~400kB in the
// lazy Canton chunk). In production builds point that one import at an empty stub.
// Scoped to the SDK as the importer, so the WalletConnect that Phantom's wallet adapter
// uses is untouched. Dev keeps the real package: its dependency optimizer must resolve it.
const stubWalletConnectForCantonSdk = (): Plugin => ({
  name: "stub-walletconnect-for-canton-sdk",
  apply: "build",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === "@walletconnect/sign-client" && importer && /[\\/]@canton-network[\\/]dapp-sdk[\\/]/.test(importer)) return "\0walletconnect-stub";
    return null;
  },
  load(id) {
    if (id === "\0walletconnect-stub") return "export default class SignClient { static init() { throw new Error('WalletConnect is not enabled in Path'); } }";
    return null;
  },
});

// The API (api/*.ts, Web-standard handlers) runs as its own small Node process during `vite dev`
// (scripts/api-dev.ts under `tsx watch`, so edits hot-reload) and Vite proxies /api to it. In
// production Vercel runs the same files as functions. Starting it here keeps `npm run dev` one command.
const API_PORT = Number(process.env.API_DEV_PORT ?? 8788);
const apiDev = (): Plugin => ({
  name: "path-api-dev",
  apply: "serve",
  configureServer(server) {
    const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "watch", "--clear-screen=false", "scripts/api-dev.ts"], { stdio: "inherit", env: process.env });
    const stop = () => child.killed || child.kill();
    server.httpServer?.once("close", stop);
    process.once("exit", stop);
  },
});

// Rome's hosted bridge-api sends no CORS headers, so the browser reaches it via
// this same-origin proxy (/bridge-api/* → the hosted API). Production does the
// same with the rewrite in vercel.json.
const bridgeProxy = {
  "/bridge-api": {
    target: "https://bridge-api.devnet.romeprotocol.xyz",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/bridge-api/, ""),
  },
};

export default defineConfig(({ mode }) => {
  // With a WalletConnect project id configured, the Canton picker offers WalletConnect and the
  // real client is bundled (lazy chunk); without one, it is stubbed out of production builds.
  const walletConnectEnabled = Boolean(loadEnv(mode, process.cwd(), "VITE_").VITE_WC_PROJECT_ID?.trim());
  return {
    plugins: [
      react(),
      apiDev(),
      // @solana/web3.js + wallet-adapter reference Node globals (`Buffer`, `global`,
      // `process`) in the browser bundle. The polyfill plugin injects real shims so
      // they resolve cleanly in both dev and build — without it Vite externalizes
      // "buffer" and Buffer is undefined at runtime.
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
      }),
      ...(walletConnectEnabled ? [] : [stubWalletConnectForCantonSdk()]),
    ],
    server: { proxy: { ...bridgeProxy, "/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } } },
    preview: { proxy: bridgeProxy },
    build: {
      // WalletApp.tsx (wagmi + viem + @solana/wallet-adapter + the Rome SDK) is
      // a legitimately heavy chunk — it's lazy-loaded and only fetched once a
      // visitor leaves the marketing pages, so 500kB isn't the right bar for it.
      // The Canton dApp SDK (+ its wallet-picker UI) is a second lazy chunk (~810kB,
      // ~1.2MB with WalletConnect), fetched only when someone connects a Canton wallet
      // or has a saved session.
      chunkSizeWarningLimit: 1300,
    },
  };
});
