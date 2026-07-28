import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Send } from "./pages/Send";
import { Bridge } from "./pages/Bridge";
import { Vault } from "./pages/Vault";
import { Apps } from "./pages/Apps";
import { Settings } from "./pages/Settings";
import { Showcase } from "./pages/Showcase";

export default function App() {
  return (
    <Routes>
      {/* Full-bleed pages — rendered outside the app chrome. */}
      <Route path="/" element={<Landing />} />
      <Route path="/showcase" element={<Showcase />} />
      {/* The wallet app, under the shell. */}
      <Route
        path="*"
        element={
          <AppShell>
            <Routes>
              <Route path="/app" element={<Dashboard />} />
              <Route path="/send" element={<Send />} />
              <Route path="/bridge" element={<Bridge />} />
              <Route path="/vault" element={<Vault />} />
              <Route path="/apps" element={<Apps />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
