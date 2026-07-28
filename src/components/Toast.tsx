// Lightweight toast system for transaction feedback across both lanes.
import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Spinner } from "./ui";

type Kind = "info" | "success" | "error" | "pending";
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  message?: string;
  href?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, "id">) => number;
  update: (id: number, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
  /** Run an async action with pending → success/error toasts. Returns the result. */
  run: <T>(label: string, fn: () => Promise<T>, opts?: { success?: string }) => Promise<T>;
}

const Ctx = createContext<ToastApi | null>(null);

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = seq++;
      setToasts((prev) => [...prev, { ...t, id }]);
      if (t.kind !== "pending") setTimeout(() => dismiss(id), 6000);
      return id;
    },
    [dismiss],
  );
  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      if (patch.kind && patch.kind !== "pending") setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const run = useCallback<ToastApi["run"]>(
    async (label, fn, opts) => {
      const id = push({ kind: "pending", title: label, message: "Awaiting confirmation…" });
      try {
        const result = await fn();
        update(id, { kind: "success", title: opts?.success ?? "Confirmed", message: label });
        return result;
      } catch (e: any) {
        update(id, { kind: "error", title: "Transaction failed", message: cleanErr(e) });
        throw e;
      }
    },
    [push, update],
  );

  return (
    <Ctx.Provider value={{ push, update, dismiss, run }}>
      {children}
      <div className="fixed z-50 bottom-24 sm:bottom-6 right-4 left-4 sm:left-auto sm:w-96 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              className="pointer-events-auto card-marble p-4 flex items-start gap-3"
            >
              <div className="mt-0.5 shrink-0">{icon(t.kind)}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-parchment">{t.title}</p>
                {t.message && <p className="text-xs text-parchment/55 mt-0.5 break-words">{t.message}</p>}
                {t.href && (
                  <a href={t.href} target="_blank" rel="noreferrer" className="text-xs text-gold-200 hover:underline mt-1 inline-block">
                    View on explorer ↗
                  </a>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-parchment/30 hover:text-parchment/70 text-sm">
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

function icon(kind: Kind) {
  if (kind === "pending") return <Spinner className="text-gold" />;
  if (kind === "success") return <span className="text-emerald-300 text-lg">✓</span>;
  if (kind === "error") return <span className="text-terracotta-300 text-lg">⚠</span>;
  return <span className="text-gold text-lg">•</span>;
}

function cleanErr(e: any): string {
  const msg = e?.shortMessage ?? e?.message ?? String(e);
  return msg.length > 180 ? msg.slice(0, 177) + "…" : msg;
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
