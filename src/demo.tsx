// Demo mode: a clearly-labeled preview that populates the UI with sample data so
// the full experience is visible without a funded wallet. Never presented as real
// holdings — the header shows a "Demo" badge whenever it's on.
import { createContext, useContext, useState, type ReactNode } from "react";

interface DemoApi {
  demo: boolean;
  enable: () => void;
  disable: () => void;
  toggle: () => void;
}

const Ctx = createContext<DemoApi | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState(false);
  return (
    <Ctx.Provider value={{ demo, enable: () => setDemo(true), disable: () => setDemo(false), toggle: () => setDemo((v) => !v) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDemo(): DemoApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
}
