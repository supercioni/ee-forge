import { describe, expect, it } from "vitest";
import { guardRequest } from "../src/main/guard.js";

const registered = new Set(["EE-2026.09.22PR-abc12345"]);
const context = { isInstallId: (id: string) => registered.has(id) };
const ask = (method: string, path: string, body?: unknown, query?: Record<string, string>) =>
  guardRequest({ method, path, ...(query !== undefined ? { query } : {}), ...(body !== undefined ? { body } : {}) }, context);

describe("the request guard", () => {
  it("passes the routes the editor uses", () => {
    for (const [method, path] of [
      ["GET", "/forge/projects"],
      ["GET", "/forge/projects/my_mission"],
      ["PUT", "/forge/projects/my_mission"],
      ["POST", "/forge/projects"],
      ["POST", "/forge/projects/my_mission/build"],
      ["GET", "/forge/catalog"],
      ["GET", "/forge/library"],
      ["GET", "/forge/installations"],
      ["GET", "/forge/compatibility"],
      ["GET", "/forge/extensions"],
      ["GET", "/forge/dmx"],
      ["DELETE", "/forge/installations/EE-2026.09.22PR-abc12345"],
      ["POST", "/forge/installations/EE-2026.09.22PR-abc12345/rescan"],
    ] as const) {
      expect(ask(method, path, method === "GET" ? undefined : {}).ok, `${method} ${path}`).toBe(true);
    }
  });

  it("refuses anything that is not a well-formed /forge/<known area> path", () => {
    for (const path of ["/etc/passwd", "forge/projects", "/forge", "/forge/unknown", "/forge/../etc", "/forge/projects/..%2F..", "/forge/projects/a b", "/forge/projects/%00", "//forge/projects", "/forge/projects?x=1"]) {
      expect(ask("GET", path).ok, path).toBe(false);
    }
    expect(guardRequest({ method: "PATCH", path: "/forge/projects" }, context).ok).toBe(false);
    expect(guardRequest({ method: "GET", path: "/forge/projects", extra: 1 }, context).ok).toBe(false);
    expect(guardRequest("GET /forge/projects", context).ok).toBe(false);
    expect(guardRequest(null, context).ok).toBe(false);
  });

  it("never takes an install path from the page: registering one is the folder dialog's job", () => {
    const post = ask("POST", "/forge/installations", { path: "C:\\Users\\Someone Else\\EmptyEpsilon" });
    expect(post).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/library/rescan", { eeDir: "/mnt/c/EE" })).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/dmx/import", { eeDir: "/mnt/c/EE" })).toMatchObject({ ok: false, status: 403 });
  });

  it("treats the install preview and the scan to check against like the install: by registered id only", () => {
    expect(ask("POST", "/forge/projects/m/install-preview", { install: "EE-2026.09.22PR-abc12345" }).ok).toBe(true);
    expect(ask("POST", "/forge/projects/m/install-preview", { install: "/home/x/EE" })).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/projects/m/build", { libraryInstall: "/home/x/EE" })).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/projects/m/build", { libraryInstall: "EE-2026.09.22PR-abc12345" }).ok).toBe(true);
  });

  it("accepts an install only by the id of a registered installation", () => {
    expect(ask("POST", "/forge/projects/m/build", { install: "/home/someone/EE", patchShipTemplates: true })).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/projects/m/build", { install: "C:\\Program Files\\EE" })).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/projects/m/build", { install: "EE-2026.09.22PR-zzzzzzzz" })).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/projects/m/build", { install: "EE-2026.09.22PR-abc12345", patchShipTemplates: true }).ok).toBe(true);
    expect(ask("POST", "/forge/projects/m/build", { mode: "vanilla" }).ok).toBe(true);
    expect(ask("POST", "/forge/dmx/build", { install: "nope" })).toMatchObject({ ok: false, status: 403 });
    expect(ask("POST", "/forge/dmx/build", {}).ok).toBe(true);
    expect(ask("POST", "/forge/library/rescan", { install: "EE-2026.09.22PR-abc12345" }).ok).toBe(true);
  });

  it("serves assets through the app protocol only", () => {
    expect(ask("GET", "/forge/assets/manifest.json")).toMatchObject({ ok: false });
  });

  it("refuses an oversized body", () => {
    const big = "x".repeat(33 * 1024 * 1024);
    expect(ask("PUT", "/forge/projects/m", { big })).toMatchObject({ ok: false, status: 413 });
  });
});
