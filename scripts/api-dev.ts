// Local stand-in for Vercel's function runtime: serves api/*.ts on 127.0.0.1:8788. Each file exports
// Web-standard method handlers (GET/POST taking a Request, returning a Response), exactly as it
// does in production. `npm run dev` starts this under `tsx watch` and Vite proxies /api to it.
import "dotenv/config";
import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.API_DEV_PORT ?? 8788);
const ROOT = process.cwd();

const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    // Letters, digits, - _ / only; files starting with _ (like _lib) are internal, never routes.
    if (!url.pathname.startsWith("/api/") || !/^[A-Za-z0-9_\-/]+$/.test(rel) || rel.split("/").some((p) => p.startsWith("_"))) return send(res, 404, { error: "not_found" });
    const file = [`api/${rel}.ts`, `api/${rel}/index.ts`].map((f) => path.join(ROOT, f)).find((f) => existsSync(f));
    if (!file) return send(res, 404, { error: "not_found" });
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const method = (req.method ?? "GET").toUpperCase();
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      const request = new Request(`http://${req.headers.host ?? `localhost:${PORT}`}${req.url}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" || !chunks.length ? undefined : Buffer.concat(chunks),
      });
      const mod = await import(pathToFileURL(file).href);
      const handler = mod[method] as ((r: Request) => Promise<Response>) | undefined;
      if (!handler) return send(res, 405, { error: "method_not_allowed" });
      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => key !== "set-cookie" && res.setHeader(key, value));
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("set-cookie", cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e: any) {
      console.error(`[api] ${req.method} ${url.pathname}:`, e?.stack ?? e);
      send(res, 500, { error: "server_error", message: String(e?.message ?? e).slice(0, 200) });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[api] dev server on http://127.0.0.1:${PORT}`));
