// Buffer/global/process are provided by vite-plugin-node-polyfills (see
// vite.config.ts) for @solana/web3.js + wallet-adapter.
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { WalletProvider } from "./wallet";
import { ToastProvider } from "./components/Toast";
import { DemoProvider } from "./demo";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <DemoProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </DemoProvider>
      </WalletProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
