/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAUCET_URL?: string;
  readonly VITE_BRIDGE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
