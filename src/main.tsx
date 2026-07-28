// Buffer/global/process are provided by vite-plugin-node-polyfills (see
// vite.config.ts) for @solana/web3.js + wallet-adapter.
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { DemoProvider } from "./demo";
import "./index.css";

// WalletProvider (wagmi/viem + @solana wallet-adapter) lives inside WalletApp,
// not here — the marketing pages don't need it, see App.tsx.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DemoProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DemoProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
