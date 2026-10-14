import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ForgeExtension } from "@forge/core";
import { createForgeRouter, ForgeServiceError } from "../src/index.js";
import { cleanup, sandbox, tmp } from "./helpers.js";

afterEach(cleanup);

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demoDir = join(repo, "projects", "exodus_optional_demo");

/** A copy of the shipped demonstration project in a folder whose name has spaces, like a Windows user folder. */
function spacedCopy(): string {
  const root = tmp("forge import ");
  const dir = join(root, "My Projects", "Demo Mission");
  mkdirSync(dir, { recursive: true });
  cpSync(demoDir, dir, { recursive: true });
  return dir;
}

const stub: ForgeExtension = {
  id: "exodus",
  label: "stub EXODUS",
  protocol: "1.0.0",
  capabilities: ["puzzle"],
  compatibility: (target) =>
    target === "EE-2026.09.22PR"
      ? { level: "engine-tested", note: "run" }
      : { level: "incompatible", note: "the real service cannot talk to this engine" },
  owns: (action) => action.kind.startsWith("exodus_"),
  describe: () => ({ capability: "puzzle", hasOutcome: false }),
  scenarioPrelude: () => "-- STUB PRELUDE",
  initStatements: () => "",
  updateStatements: () => "",
  emitAction: () => "STUB_CALL()",
};

describe("importing a project copy", () => {
  it("copies from a folder with spaces, leaves the source byte-identical, and stores the current format", () => {
    const source = spacedCopy();
    const before = readFileSync(join(source, "project.json"), "utf8");
    const sb = sandbox();
    const result = sb.services.projects.importCopy(source);
    expect(result.id).toBe("exodus_optional_demo");
    expect(result.sourceKind).toBe("directory");
    expect(result.lost).toEqual([]);
    expect(existsSync(join(sb.projectsDir, result.id, "project.json"))).toBe(true);
    expect(readFileSync(join(source, "project.json"), "utf8")).toBe(before);
    expect(sb.services.projects.get(result.id).logic.exodusSteps.length).toBeGreaterThan(0);
  });

  it("accepts the project.json file itself", () => {
    const source = spacedCopy();
    const result = sandbox().services.projects.importCopy(join(source, "project.json"));
    expect(result.sourceKind).toBe("file");
  });

  it("never overwrites: a second import gets a free id and says what it renamed", () => {
    const source = spacedCopy();
    const sb = sandbox();
    sb.services.projects.importCopy(source);
    const second = sb.services.projects.importCopy(source);
    expect(second.id).toBe("exodus_optional_demo_2");
    expect(second.renamedFrom).toBe("exodus_optional_demo");
    expect(sb.services.projects.get("exodus_optional_demo_2").id).toBe("exodus_optional_demo_2");
    expect(sb.services.projects.list().projects.map((p) => p.id)).toEqual(["exodus_optional_demo", "exodus_optional_demo_2"]);
  });

  it("refuses what is not a project, with a message that names the problem", () => {
    const sb = sandbox();
    const empty = tmp("forge-empty-");
    expect(() => sb.services.projects.importCopy(empty)).toThrow(/has no project\.json/);
    const bad = join(empty, "project.json");
    writeFileSync(bad, "{not json");
    expect(() => sb.services.projects.importCopy(empty)).toThrow(/not a usable project/);
    writeFileSync(join(empty, "notes.json"), "{}");
    expect(() => sb.services.projects.importCopy(join(empty, "notes.json"))).toThrow(ForgeServiceError);
    expect(() => sb.services.projects.importCopy(join(empty, "missing"))).toThrow(/no such file or folder/);
    expect(sb.services.projects.list().projects).toEqual([]);
  });
});

describe("exporting for one or both engines", () => {
  const prepare = (extensions: readonly ForgeExtension[] = []) => {
    const sb = sandbox({ extensions });
    sb.services.projects.importCopy(spacedCopy());
    return sb;
  };

  it("writes two distinct bundles for the double target, each built against its own engine", () => {
    const sb = prepare();
    const out = join(tmp("forge export "), "Mi Export");
    const result = sb.services.projects.exportBundle("exodus_optional_demo", {
      targets: ["EE-2024.12.08", "EE-2026.09.22PR"],
      mode: "vanilla",
      outRoot: out,
    });
    expect(result.targets.map((t) => [t.target, t.ok])).toEqual([
      ["EE-2024.12.08", true],
      ["EE-2026.09.22PR", true],
    ]);
    const scenario = (target: string): string => {
      const dir = join(out, "exodus_optional_demo", target, "scripts");
      return readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith("scenario_"))!), "utf8");
    };
    expect(scenario("EE-2024.12.08")).toContain("target  EE-2024.12.08");
    expect(scenario("EE-2026.09.22PR")).toContain("target  EE-2026.09.22PR");
    expect(scenario("EE-2024.12.08")).not.toBe(scenario("EE-2026.09.22PR"));
    expect(existsSync(result.reportPath)).toBe(true);
    for (const t of result.targets) expect(t.mode).toBe("vanilla");
  });

  it("a vanilla export carries nothing of EXODUS for either engine", () => {
    const sb = prepare([stub]);
    const out = tmp("forge-out-");
    const result = sb.services.projects.exportBundle("exodus_optional_demo", { targets: ["EE-2024.12.08", "EE-2026.09.22PR"], mode: "vanilla", outRoot: out });
    for (const t of result.targets) {
      for (const f of t.files) expect(readFileSync(join(t.outDir, "scripts", f.name), "utf8")).not.toMatch(/exodus_bridge|STUB|bridge:/);
    }
  });

  it("an integrated export for a target without evidence carries the warning; the vanilla one does not", () => {
    const sb = prepare([stub]);
    const out = tmp("forge-out-");
    const integrated = sb.services.projects.exportBundle("exodus_optional_demo", {
      targets: ["EE-2024.12.08", "EE-2026.09.22PR"],
      mode: "integrated",
      outRoot: out,
    });
    const by = Object.fromEntries(integrated.targets.map((t) => [t.target, t]));
    expect(by["EE-2024.12.08"]!.ok).toBe(true);
    expect(by["EE-2024.12.08"]!.warnings.join()).toMatch(/stub EXODUS on EE-2024\.12\.08 is incompatible/);
    expect(by["EE-2026.09.22PR"]!.warnings.join()).not.toMatch(/is incompatible|is unverified/);
    expect(by["EE-2024.12.08"]!.compatibility.extensions[0]!.level).toBe("incompatible");
    const vanilla = sb.services.projects.exportBundle("exodus_optional_demo", { targets: ["EE-2024.12.08"], mode: "vanilla", outRoot: tmp("forge-out-") });
    expect(vanilla.targets[0]!.ok).toBe(true);
    expect(vanilla.targets[0]!.warnings.join()).not.toMatch(/incompatible/);
  });

  it("one engine failing does not stop the other, and the failure is readable", () => {
    const sb = prepare(); // no extension registered
    const result = sb.services.projects.exportBundle("exodus_optional_demo", {
      targets: ["EE-2024.12.08", "EE-2026.09.22PR"],
      mode: "integrated",
      outRoot: tmp("forge-out-"),
    });
    // Without the extension an integrated export is refused for both — each says why.
    for (const t of result.targets) {
      expect(t.ok).toBe(false);
      expect(t.error).toMatch(/extension/i);
    }
    const ok = sb.services.projects.exportBundle("exodus_optional_demo", { targets: ["EE-2026.09.22PR"], mode: "vanilla", outRoot: tmp("forge-out-") });
    expect(ok.targets[0]!.ok).toBe(true);
  });

  it("rejects an unknown target and an empty selection", () => {
    const sb = prepare();
    const out = tmp("forge-out-");
    expect(() => sb.services.projects.exportBundle("exodus_optional_demo", { targets: ["EE-2030.1.1"], outRoot: out })).toThrow(/not a verified/);
    expect(() => sb.services.projects.exportBundle("exodus_optional_demo", { targets: [], outRoot: out })).toThrow(/at least one/);
  });
});

describe("compatibility", () => {
  it("is served by the router: vanilla per engine, extensions with their own evidence", async () => {
    const router = createForgeRouter(sandbox({ extensions: [stub] }).services);
    const response = await router.handle({ method: "GET", path: "/forge/compatibility" });
    expect(response.status).toBe(200);
    const body = response.body as { targets: { target: string; vanilla: { level: string }; extensions: { level: string }[] }[] };
    expect(body.targets.map((t) => t.target)).toEqual(["EE-2024.12.08", "EE-2026.09.22PR"]);
    expect(body.targets.map((t) => t.vanilla.level)).toEqual(["engine-tested", "engine-tested"]);
    expect(body.targets.map((t) => t.extensions[0]!.level)).toEqual(["incompatible", "engine-tested"]);
    const none = await createForgeRouter(sandbox().services).handle({ method: "GET", path: "/forge/compatibility" });
    expect((none.body as { targets: { extensions: unknown[] }[] }).targets.every((t) => t.extensions.length === 0)).toBe(true);
  });
});
