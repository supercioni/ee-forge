import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the built app (dist/) may and may not contain. Needs `pnpm build` first; skipped when dist/ is absent
 * so a plain `pnpm test` stays fast on a fresh checkout.
 */
const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkg, "..", "..");
const dist = join(pkg, "dist");
const built = existsSync(join(dist, "main.cjs")) && existsSync(join(dist, "renderer", "index.html"));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe.skipIf(!built)("the built desktop app", () => {
  const code = ["main.cjs", "preload.cjs"].map((f) => readFileSync(join(dist, f), "utf8"));

  it("embeds no path of the developer's machine or repository", () => {
    for (const text of code) {
      expect(text).not.toContain(repo);
      expect(text).not.toMatch(/\/home\/[a-z]+\//);
      expect(text).not.toMatch(/C:\\Users\\[A-Za-z]+\\/);
      expect(text).not.toContain("/mnt/c/");
    }
    const manifest = readFileSync(join(dist, "package.json"), "utf8");
    expect(manifest).not.toContain(repo);
  });

  it("carries no EmptyEpsilon executable, and no engine file at all", () => {
    const names = walk(dist).map((f) => f.toLowerCase());
    expect(names.filter((n) => /\.(exe|dll)$/.test(n) || n.endsWith("emptyepsilon"))).toEqual([]);
    expect(names.filter((n) => n.includes("script_reference"))).toEqual([]);
  });

  it("has no server and no EXODUS in it", () => {
    for (const text of code) {
      expect(text).not.toMatch(/@exodus\//);
      expect(text).not.toContain("exodus_bridge.lua\"");
      expect(text).not.toMatch(/createServer\(\)|\.listen\(/);
    }
    // The optional module is a separate file, present only when the build asked for it.
    expect(existsSync(join(dist, "resources", "optional", "exodus-extension.mjs"))).toBe(false);
  });

  it("is started by electron from dist/package.json and serves the editor it carries", () => {
    const manifest = JSON.parse(readFileSync(join(dist, "package.json"), "utf8")) as { main: string; productName: string };
    expect(manifest.main).toBe("main.cjs");
    expect(manifest.productName).toBe("EE FORGE");
    expect(readFileSync(join(dist, "renderer", "index.html"), "utf8")).toContain("<div id=\"root\">");
    expect(existsSync(join(dist, "resources", "assets", "manifest.json"))).toBe(true);
  });

  it("keeps the renderer isolated: the window is created with the safe preferences", () => {
    const main = code[0]!;
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
  });

  it("starts no other program: no child_process in the main process or the preload", () => {
    for (const text of code) expect(text).not.toMatch(/require\(["'](node:)?child_process["']\)/);
  });

  it("ships only the assets the licence inventory allows, and a manifest with nothing it withheld", () => {
    const inventory = JSON.parse(readFileSync(join(dist, "resources", "licenses", "asset-inventory.json"), "utf8")) as Array<{ path: string; distribute: boolean; license: string | null }>;
    const allowed = new Set(inventory.filter((e) => e.distribute).map((e) => e.path));
    const shipped = walk(join(dist, "resources", "assets")).map((f) => f.slice(join(dist, "resources", "assets").length + 1).split("\\").join("/")).filter((f) => f !== "manifest.json");
    expect(shipped.filter((f) => !allowed.has(f))).toEqual([]);
    for (const e of inventory.filter((x) => x.distribute)) expect(e.license, e.path).toMatch(/^(CC0-1\.0|CC-BY-(3|4)\.0)$/);
    const manifest = JSON.parse(readFileSync(join(dist, "resources", "assets", "manifest.json"), "utf8")) as Record<string, { model?: string }>;
    for (const [key, entry] of Object.entries(manifest)) if (entry.model !== undefined) expect(allowed.has(entry.model), key).toBe(true);
    // Everything EmptyEpsilon-derived or without provenance is withheld.
    expect(inventory.filter((e) => e.path.startsWith("ee-ships/") && e.distribute)).toEqual([]);
  });

  it("carries third-party notices that name the bundled libraries with their licence text", () => {
    const notices = readFileSync(join(dist, "resources", "licenses", "THIRD-PARTY-NOTICES.txt"), "utf8");
    expect(notices).toContain("--- three ");
    expect(notices).toContain("--- react ");
    expect(notices).toContain("--- zod ");
    expect(notices).toMatch(/Permission is hereby granted, free of charge/);
    expect(notices).toContain("LICENSES.chromium.html");
    expect(notices).not.toContain(repo);
  });
});
