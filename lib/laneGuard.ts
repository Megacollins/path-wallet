// Two protections for Phantom-lane actions, kept in the browser so they survive a reload and apply across tabs:
//  • a record of a transaction that was SENT but whose outcome is not known yet. Until it is resolved the app refuses
//    to repeat the action: a retry after "sent but not confirmed in time" would otherwise deposit or send twice.
//  • a lock, so two taps or two tabs can't run two actions for the same wallet at once.
// Storage failures (private windows, blocked storage) fall back to memory for the page's lifetime.

export interface Pending {
  /** What was sent, for messages: "Deposit into the vault". */
  label: string;
  /** The Rome transaction hash, when the lane returned one. */
  hash?: string;
  /** The Solana signature, when only that is known (the Solana confirmation timed out). */
  signature?: string;
  /** When it was sent (ms). */
  at: number;
}

export interface LaneGuard {
  getPending(wallet: string): Pending | null;
  setPending(wallet: string, p: Pending): void;
  clearPending(wallet: string): void;
  /** Returns a token when the lock was taken (it expires on its own after `ttlMs`), or null when someone holds it. */
  tryLock(wallet: string, ttlMs?: number): string | null;
  unlock(wallet: string, token: string): void;
}

/** In-memory guard: used in tests and as the fallback when storage is unavailable. */
export function memoryGuard(): LaneGuard {
  const pending = new Map<string, Pending>();
  const locks = new Map<string, { token: string; until: number }>();
  return {
    getPending: (w) => pending.get(w) ?? null,
    setPending: (w, p) => void pending.set(w, p),
    clearPending: (w) => void pending.delete(w),
    tryLock: (w, ttlMs = 180_000) => {
      const held = locks.get(w);
      if (held && held.until > Date.now()) return null;
      const token = Math.random().toString(36).slice(2);
      locks.set(w, { token, until: Date.now() + ttlMs });
      return token;
    },
    unlock: (w, token) => {
      if (locks.get(w)?.token === token) locks.delete(w);
    },
  };
}

/** Guard backed by localStorage (shared by every tab of this browser), with memory as the fallback. */
export function browserGuard(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): LaneGuard {
  const mem = memoryGuard();
  const memLocks = new Map<string, { token: string; until: number }>();
  const pk = (w: string) => `path:lane:pending:${w}`;
  const lk = (w: string) => `path:lane:lock:${w}`;
  const read = <T,>(key: string): T | null => {
    try {
      const raw = storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };
  return {
    getPending: (w) => read<Pending>(pk(w)) ?? mem.getPending(w),
    setPending: (w, p) => {
      mem.setPending(w, p);
      try {
        storage?.setItem(pk(w), JSON.stringify(p));
      } catch {
        /* the memory copy still protects this page */
      }
    },
    clearPending: (w) => {
      mem.clearPending(w);
      try {
        storage?.removeItem(pk(w));
      } catch {
        /* ignore */
      }
    },
    tryLock: (w, ttlMs = 180_000) => {
      const now = Date.now();
      const mine = memLocks.get(w);
      if (mine && mine.until > now) return null; // this tab already holds it
      const other = read<{ token: string; until: number }>(lk(w));
      if (other && other.until > now) return null; // another tab holds it
      const token = Math.random().toString(36).slice(2);
      memLocks.set(w, { token, until: now + ttlMs });
      try {
        storage?.setItem(lk(w), JSON.stringify({ token, until: now + ttlMs }));
      } catch {
        /* the in-tab lock still protects this page */
      }
      // Two tabs can write at the same moment: whoever's token is stored now keeps the lock.
      const stored = read<{ token: string }>(lk(w));
      if (storage && stored && stored.token !== token) {
        memLocks.delete(w);
        return null;
      }
      return token;
    },
    unlock: (w, token) => {
      if (memLocks.get(w)?.token === token) memLocks.delete(w);
      if (read<{ token: string }>(lk(w))?.token === token) {
        try {
          storage?.removeItem(lk(w));
        } catch {
          /* ignore */
        }
      }
    },
  };
}
