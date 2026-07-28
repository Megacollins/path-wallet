import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @solana/web3.js + wallet-adapter reference Node globals (`Buffer`, `global`,
// `process`) in the browser bundle. The polyfill plugin injects real shims so
// they resolve cleanly in both dev and build — without it Vite externalizes
// "buffer" and Buffer is undefined at runtime.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
});
