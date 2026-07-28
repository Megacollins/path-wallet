// Everything that needs a connected wallet, split into its own lazy chunk so
// the marketing Landing/Showcase pages never pull in wagmi/viem/@solana — those
// only load once a visitor actually navigates into the app.
import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { WalletProvider } from "./wallet";
import { AppShell } from "./components/layout";
import { Spinner } from "./components/ui";

const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Send = lazy(() => import("./pages/Send").then((m) => ({ default: m.Send })));
const Bridge = lazy(() => import("./pages/Bridge").then((m) => ({ default: m.Bridge })));
const Vault = lazy(() => import("./pages/Vault").then((m) => ({ default: m.Vault })));
const Apps = lazy(() => import("./pages/Apps").then((m) => ({ default: m.Apps })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner className="h-6 w-6 text-gold-200" />
    </div>
  );
}

export function WalletApp() {
  return (
    <WalletProvider>
      <AppShell>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/app" element={<Dashboard />} />
            <Route path="/send" element={<Send />} />
            <Route path="/bridge" element={<Bridge />} />
            <Route path="/vault" element={<Vault />} />
            <Route path="/apps" element={<Apps />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </Suspense>
      </AppShell>
    </WalletProvider>
  );
}
