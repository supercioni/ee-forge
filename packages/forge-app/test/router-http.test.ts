import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createForgeHttpServer, createForgeRouter } from "../src/index.js";
import { cleanup, fakeInstall, haveReferences, sandbox, tmp } from "./helpers.js";

afterEach(cleanup);

describe("router (transport-neutral)", () => {
  it("answers health, catalogs per target, and refuses an unknown target", async () => {
    const router = createForgeRouter(sandbox().services);
    expect((await router.handle({ method: "GET", path: "/forge/health" })).body).toEqual({ ok: true, app: "forge" });
    const c24 = await router.handle({ method: "GET", path: "/forge/catalog", query: { target: "EE-2024.12.08" } });
    expect((c24.body as { eeVersion: string }).eeVersion).toBe("EE-2024.12.08");
    expect((await router.handle({ method: "GET", path: "/forge/catalog", query: { target: "x" } })).status).toBe(400);
  });

  it("maps service errors to status + path, unknown routes to 404", async () => {
    const router = createForgeRouter(sandbox().services);
    const missing = await router.handle({ method: "GET", path: "/forge/projects/none" });
    expect(missing).toMatchObject({ status: 404, body: { error: expect.stringContaining("no project") } });
    expect((await router.handle({ method: "GET", path: "/forge/nothing" })).status).toBe(404);
    expect((await router.handle({ method: "GET", path: "/elsewhere" })).status).toBe(404);
    const bad = await router.handle({ method: "POST", path: "/forge/projects", body: { id: "Bad Id!" } });
    expect(bad.status).toBe(400);
  });

  it("serves bundled assets as bytes and blocks traversal", async () => {
    const { services } = sandbox();
    const router = createForgeRouter(services);
    const ok = await router.handle({ method: "GET", path: "/forge/assets/planets/shared-name.png" });
    expect(ok).toMatchObject({ status: 200, contentType: "image/png" });
    expect(Buffer.from(ok.bytes!).toString()).toBe("BUNDLED");
    expect((await router.handle({ method: "GET", path: "/forge/assets/..%2F..%2Fetc%2Fpasswd" })).status).toBe(404);
  });

  it.skipIf(!haveReferences)("registers, scans and lists installations over the contract", async () => {
    const router = createForgeRouter(sandbox().services);
    const dir = fakeInstall("EE-2026.09.22PR", "T");
    const registered = await router.handle({ method: "POST", path: "/forge/installations", body: { path: dir } });
    expect(registered.status).toBe(201);
    const id = (registered.body as { id: string }).id;
    const scan = await router.handle({ method: "POST", path: `/forge/installations/${id}/rescan` });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({ verified: true, target: "EE-2026.09.22PR" });
    const listed = await router.handle({ method: "GET", path: "/forge/installations" });
    expect((listed.body as { installations: unknown[] }).installations).toHaveLength(1);
    const lib = await router.handle({ method: "GET", path: "/forge/library", query: { target: "EE-2026.09.22PR" } });
    expect((lib.body as { library: { eeVersion: string } }).library.eeVersion).toBe("EE-2026.09.22PR");
    expect((await router.handle({ method: "DELETE", path: `/forge/installations/${id}` })).status).toBe(200);
    expect((await router.handle({ method: "DELETE", path: `/forge/installations/${id}` })).status).toBe(404);
  });
});

describe("standalone HTTP server (no bridge, no EXODUS)", () => {
  async function start(staticDir?: string) {
    const { services } = sandbox();
    const server = createForgeHttpServer(createForgeRouter(services), { staticDir: staticDir ?? null });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  it("creates, saves, reopens and builds a project over HTTP", async () => {
    const { base, close } = await start();
    try {
      const json = { "content-type": "application/json" };
      const created = await fetch(`${base}/forge/projects`, { method: "POST", headers: json, body: JSON.stringify({ id: "web", name: "Web", description: "" }) });
      expect(created.status).toBe(201);
      const project = (await created.json()) as { project: { id: string } };
      const put = await fetch(`${base}/forge/projects/web`, { method: "PUT", headers: json, body: JSON.stringify(project.project) });
      expect(put.status).toBe(200);
      expect(((await (await fetch(`${base}/forge/projects/web`)).json()) as { id: string }).id).toBe("web");
      const built = await fetch(`${base}/forge/projects/web/build`, { method: "POST", headers: json, body: "{}" });
      expect(built.status).toBe(200);
      expect(((await built.json()) as { files: unknown[] }).files.length).toBeGreaterThanOrEqual(3);
      const asset = await fetch(`${base}/forge/assets/planets/shared-name.png`);
      expect(asset.headers.get("content-type")).toBe("image/png");
      expect(await asset.text()).toBe("BUNDLED");
      expect((await fetch(`${base}/forge/projects`, { method: "POST", headers: json, body: "{not json" })).status).toBe(400);
    } finally {
      await close();
    }
  });

  it("serves a built editor from the static directory", async () => {
    const dir = tmp("forge-static-");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<h1>forge</h1>");
    writeFileSync(join(dir, "sub", "a.js"), "1");
    const { base, close } = await start(dir);
    try {
      expect(await (await fetch(`${base}/`)).text()).toBe("<h1>forge</h1>");
      expect((await fetch(`${base}/sub/a.js`)).headers.get("content-type")).toContain("javascript");
      expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    } finally {
      await close();
    }
  });
});
