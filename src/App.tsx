import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui";

// Route-level code splitting: the marketing pages (Landing, Showcase) never
// need wagmi/viem/@solana, so the entire wallet app — provider tree, shell,
// and its pages — lives in one lazy chunk (see WalletApp.tsx) that only loads
// once a visitor actually navigates past the landing page.
const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const Showcase = lazy(() => import("./pages/Showcase").then((m) => ({ default: m.Showcase })));
const WalletApp = lazy(() => import("./WalletApp").then((m) => ({ default: m.WalletApp })));

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner className="h-6 w-6 text-gold-200" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Full-bleed pages — rendered outside the app chrome. */}
        <Route path="/" element={<Landing />} />
        <Route path="/showcase" element={<Showcase />} />
        {/* The wallet app: its own provider tree + shell + pages, all lazy. */}
        <Route path="*" element={<WalletApp />} />
      </Routes>
    </Suspense>
  );
}
