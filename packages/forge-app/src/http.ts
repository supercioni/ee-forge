import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { ForgeRouter } from "./router.js";

export interface ForgeHttpOptions {
  /**
   * Built editor (`web-forge/dist`) to serve at `/`, making the server a
   * complete browser-mode Forge. Optional: the API works without it.
   */
  readonly staticDir?: string | null;
  /** Allowed `Origin` for cross-origin dev setups (the Vite dev server). Default: none. */
  readonly corsOrigin?: string | null;
}

const MAX_BODY = 32 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw === "") return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const STATIC_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
};

/**
 * Forge's own HTTP server — no Fastify, no EXODUS. It carries the router over
 * HTTP for browser mode and serves the built editor; it starts no bridge,
 * campaign or watcher.
 */
export function createForgeHttpServer(router: ForgeRouter, options: ForgeHttpOptions = {}): Server {
  const staticDir = options.staticDir ?? null;

  const send = (res: ServerResponse, status: number, headers: Record<string, string>, body: Uint8Array | string): void => {
    const cors = options.corsOrigin;
    res.writeHead(status, {
      ...(cors !== undefined && cors !== null
        ? { "access-control-allow-origin": cors, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" }
        : {}),
      ...headers,
    });
    res.end(body);
  };

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://forge.local");
      if (req.method === "OPTIONS") return send(res, 204, {}, "");

      if (url.pathname.startsWith("/forge/")) {
        let body: unknown;
        try {
          body = await readBody(req);
        } catch (error) {
          return send(res, 400, { "content-type": "application/json" }, JSON.stringify({ error: String(error instanceof Error ? error.message : error), path: null }));
        }
        const response = await router.handle({
          method: req.method ?? "GET",
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body,
        });
        if (response.bytes !== undefined) {
          return send(res, response.status, { "content-type": response.contentType ?? "application/octet-stream" }, response.bytes);
        }
        return send(res, response.status, { "content-type": "application/json" }, JSON.stringify(response.body));
      }

      if (staticDir !== null && (req.method === "GET" || req.method === "HEAD")) {
        const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
        const file = normalize(join(staticDir, relative));
        if (file.startsWith(staticDir + sep) && existsSync(file) && statSync(file).isFile()) {
          return send(res, 200, { "content-type": STATIC_TYPES[extname(file)] ?? "application/octet-stream" }, readFileSync(file));
        }
      }
      send(res, 404, { "content-type": "application/json" }, JSON.stringify({ error: "not found", path: null }));
    })().catch((error: unknown) => {
      send(res, 500, { "content-type": "application/json" }, JSON.stringify({ error: String(error), path: null }));
    });
  });
}
