import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ForgeServiceError } from "../src/index.js";
import { cleanup, fakeInstall, haveReferences, REFERENCE, sandbox } from "./helpers.js";

afterEach(cleanup);

const T24 = "EE-2024.12.08";
const T26 = "EE-2026.09.22PR";

/** Every file under a directory with its size and mtime, to prove nothing was written. */
function snapshot(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) snapshot(full, out);
    else out[full] = `${info.size}:${info.mtimeMs}`;
  }
  return out;
}

describe.skipIf(!haveReferences)("installation identity", () => {
  it("recognises each engine from its own script reference", () => {
    const { services } = sandbox();
    const a = services.installations.register({ path: fakeInstall(T24, "a") });
    const b = services.installations.register({ path: fakeInstall(T26, "b") });
    expect(a).toMatchObject({ target: T24, verified: true });
    expect(b).toMatchObject({ target: T26, verified: true });
    expect(a.id).not.toBe(b.id);
    expect(a.evidence).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent per path and keeps two copies of one engine apart", () => {
    const { services } = sandbox();
    const path = fakeInstall(T26, "x");
    const first = services.installations.register({ path });
    const again = services.installations.register({ path });
    expect(again.id).toBe(first.id);
    expect(again.addedAt).toBe(first.addedAt);
    const other = services.installations.register({ path: fakeInstall(T26, "y") });
    expect(other.id).not.toBe(first.id);
    expect(services.installations.list()).toHaveLength(2);
  });

  it("refuses a declared version that contradicts the evidence", () => {
    const { services } = sandbox();
    const path = fakeInstall(T24, "a");
    expect(() => services.installations.register({ path, eeVersion: T26 })).toThrow(/is EE-2024\.12\.08, not EE-2026/);
  });

  it("needs a declared version for an unrecognised build, and keeps it unverified", () => {
    const { services } = sandbox();
    const path = fakeInstall(null, "a");
    expect(() => services.installations.register({ path })).toThrow(ForgeServiceError);
    const entry = services.installations.register({ path, eeVersion: T24 });
    expect(entry).toMatchObject({ target: T24, verified: false, evidence: null });
    expect(() => services.installations.register({ path, eeVersion: "EE-2099" })).toThrow(/not a verified target/);
  });

  it("notices a verified install that changed engine and refuses to scan it", () => {
    const { services } = sandbox();
    const path = fakeInstall(T24, "a");
    const entry = services.installations.register({ path });
    writeFileSync(join(path, "script_reference.html"), "<html>another build</html>");
    expect(() => services.libraries.rescan(entry.id)).toThrow(/now identifies as an unrecognised build/);
  });

  it("forgets an install without touching its files", () => {
    const { services } = sandbox();
    const path = fakeInstall(T26, "a");
    const entry = services.installations.register({ path });
    services.installations.remove(entry.id);
    expect(services.installations.get(entry.id)).toBeNull();
    expect(existsSync(join(path, "resources", "planets", "shared-name.png"))).toBe(true);
  });
});

describe.skipIf(!haveReferences)("two installs never overwrite each other", () => {
  it("keeps libraries and asset caches apart, even for identical file names", () => {
    const { services, bundled, projectsDir } = sandbox();
    const i24 = fakeInstall(T24, "TEXTURE-2024");
    const i26 = fakeInstall(T26, "TEXTURE-2026");
    const before24 = snapshot(i24);
    const before26 = snapshot(i26);
    const bundledBefore = snapshot(bundled);

    const r24 = services.libraries.rescan(services.installations.register({ path: i24 }).id);
    const lib26Entry = services.installations.register({ path: i26 });
    const r26 = services.libraries.rescan(lib26Entry.id);

    expect(r24.library.eeVersion).toBe(T24);
    expect(r26.library.eeVersion).toBe(T26);
    expect(r24.copied).toContain("planets/shared-name.png");

    // Distinct stored libraries.
    const stored = readdirSync(join(projectsDir, "libraries")).sort();
    expect(stored).toHaveLength(2);
    // Each engine resolves its own texture, and the bundled set is the fallback.
    const own = (target: string) => readFileSync(join(projectsDir, "cache", services.installations.activeFor(target)!.id, "assets", "planets", "shared-name.png"), "utf8");
    expect(own(T24)).toBe("TEXTURE-2024");
    expect(own(T26)).toBe("TEXTURE-2026");
    const served = (target: string) => Buffer.from(services.assets.resolve("planets/shared-name.png", { target }).bytes).toString("utf8");
    expect(served(T24)).toBe("TEXTURE-2024");
    expect(served(T26)).toBe("TEXTURE-2026");
    expect(Buffer.from(services.assets.resolve("planets/shared-name.png").bytes).toString("utf8")).toBe("BUNDLED");

    // Rescanning one leaves the other untouched.
    const lib24File = join(projectsDir, "libraries", `${services.installations.activeFor(T24)!.id}.json`);
    const lib24Before = readFileSync(lib24File, "utf8");
    services.libraries.rescan(lib26Entry.id);
    expect(readFileSync(lib24File, "utf8")).toBe(lib24Before);

    // Neither the installs nor the bundled assets were written to.
    expect(snapshot(i24)).toEqual(before24);
    expect(snapshot(i26)).toEqual(before26);
    expect(snapshot(bundled)).toEqual(bundledBefore);
  });

  it("serves the chosen installation's file when two installations are the same version — not the one scanned last", () => {
    const { services } = sandbox();
    const first = services.installations.register({ path: fakeInstall(T26, "FIRST-26") });
    services.libraries.rescan(first.id);
    const second = services.installations.register({ path: fakeInstall(T26, "SECOND-26") });
    services.libraries.rescan(second.id);
    const served = (scope: { installId?: string; target?: string }) => Buffer.from(services.assets.resolve("planets/shared-name.png", scope).bytes).toString("utf8");
    expect(served({ target: T26 })).toBe("SECOND-26"); // by engine alone: the most recently scanned
    expect(served({ target: T26, installId: first.id })).toBe("FIRST-26");
    expect(served({ target: T26, installId: second.id })).toBe("SECOND-26");
    // An installation of another engine is not served as this engine's.
    const e24 = services.installations.register({ path: fakeInstall(T24, "ONLY-24") });
    services.libraries.rescan(e24.id);
    expect(served({ target: T26, installId: e24.id })).toBe("BUNDLED");
  });

  it("selects the library by explicit install, then target, and ignores a legacy library of another engine", () => {
    const { services, projectsDir } = sandbox();
    const e24 = services.installations.register({ path: fakeInstall(T24, "a") });
    services.libraries.rescan(e24.id);
    expect(services.libraries.select({ installId: e24.id }).library?.eeVersion).toBe(T24);
    expect(services.libraries.select({ target: T24 }).library?.eeVersion).toBe(T24);
    expect(services.libraries.select({ target: T26 }).library).toBeNull();

    // A 2024 library under the old single-file name must not answer for 2026.
    const lib = readFileSync(join(projectsDir, "libraries", `${e24.id}.json`), "utf8");
    writeFileSync(join(projectsDir, "ee-library.json"), lib);
    expect(services.libraries.select({ target: T26 }).library).toBeNull();
    expect(services.libraries.select({ target: T24 }).library?.eeVersion).toBe(T24);
  });

  it("serves no file outside the stores", () => {
    const { services } = sandbox();
    expect(() => services.assets.resolve("../etc/passwd")).toThrow(/no asset/);
    expect(() => services.assets.resolve("planets/../../x")).toThrow(/no asset/);
    expect(() => services.assets.resolve("missing.png")).toThrow(/no asset/);
  });
});

describe("references on this machine", () => {
  it("are optional: the suite above skips cleanly without the installs", () => {
    expect(typeof REFERENCE[T24]).toBe("string");
  });
});
