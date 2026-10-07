import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

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
  ],
  server: { proxy: bridgeProxy },
  preview: { proxy: bridgeProxy },
  build: {
    // WalletApp.tsx (wagmi + viem + @solana/wallet-adapter + the Rome SDK) is
    // a legitimately heavy chunk — it's lazy-loaded and only fetched once a
    // visitor leaves the marketing pages, so 500kB isn't the right bar for it.
    chunkSizeWarningLimit: 750,
  },
});
