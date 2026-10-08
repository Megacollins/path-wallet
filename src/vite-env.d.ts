/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAUCET_URL?: string;
  readonly VITE_BRIDGE_API_URL?: string;
  /** WalletConnect / Reown project id — enables mobile & cross-device Canton wallets. Optional. */
  readonly VITE_WC_PROJECT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
