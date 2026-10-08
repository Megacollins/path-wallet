import { defineConfig, type Plugin } from "vite";
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

// @solana/web3.js + wallet-adapter reference Node globals (`Buffer`, `global`,
// `process`) in the browser bundle. The polyfill plugin injects real shims so
// they resolve cleanly in both dev and build — without it Vite externalizes
// "buffer" and Buffer is undefined at runtime.
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

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
    stubWalletConnectForCantonSdk(),
  ],
  server: { proxy: bridgeProxy },
  preview: { proxy: bridgeProxy },
  build: {
    // WalletApp.tsx (wagmi + viem + @solana/wallet-adapter + the Rome SDK) is
    // a legitimately heavy chunk — it's lazy-loaded and only fetched once a
    // visitor leaves the marketing pages, so 500kB isn't the right bar for it.
    // The Canton dApp SDK (+ its wallet-picker UI) is a second lazy chunk (~810kB),
    // fetched only when someone connects a Canton wallet or has a saved session.
    chunkSizeWarningLimit: 900,
  },
});
