// Minimal JSON-RPC client for the indexer: timeouts, bounded retries on transient failures, and a
// typed error that carries the node's "max block range" hint so callers can adapt their page size.

export class RpcError extends Error {
  constructor(
    message: string,
    public code?: number,
    /** Present when the node says how wide an eth_getLogs range may be ("max 12000"). */
    public maxRange?: number,
    public retryable = false,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rpc<T = unknown>(url: string, method: string, params: unknown[], opts: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 2 } = opts;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "path-wallet-indexer/1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${new URL(url).host}`, res.status, undefined, res.status >= 500 || res.status === 429);
      const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
      if (body.error) {
        const msg = body.error.message ?? "rpc error";
        const range = /max(?:imum)?\D{0,12}(\d{3,})/i.exec(msg);
        throw new RpcError(msg, body.error.code, range ? Number(range[1]) : undefined, false);
      }
      return body.result as T;
    } catch (e) {
      last = e;
      // JSON-RPC errors and 4xx are answers, not glitches: don't retry them.
      const transient = e instanceof RpcError ? e.retryable : true; // network failure / timeout
      if (!transient || attempt === retries) break;
      await sleep(250 * (attempt + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export const hexToNum = (h: unknown): number => Number(BigInt(String(h)));
export const numToHex = (n: number): string => "0x" + n.toString(16);
