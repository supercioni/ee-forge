import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EEProjectSchema, type EELibrary, type EEProject } from "@forge/contracts";
import { catalogProvenance, loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { luaRuntime, runtimeNames } from "../src/codegen/logic.js";
import { CodegenError, renderGlobalCall, str } from "../src/codegen/lua.js";
import { detectInstallTarget } from "../src/scan/detect.js";
import { EE_TARGETS, TARGET_2024, TARGET_2026, requireTarget } from "../src/targets.js";

import { echoExtension } from "./fixtures/echo-extension.js";
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const catalogDir = join(here, "..", "src", "catalog");

const PROJECTS = ["forge_demo"];

function readProject(id: string): { project: EEProject; raw: string } {
  const raw = readFileSync(join(repoRoot, "projects", id, "project.json"), "utf8");
  return { project: EEProjectSchema.parse(JSON.parse(raw)), raw };
}

const withTarget = (project: EEProject, eeVersion: string): EEProject => ({ ...project, eeVersion });

describe("target registry", () => {
  it("registers both engines with a catalog that declares its own version", () => {
    expect(EE_TARGETS.map((t) => t.id)).toEqual([TARGET_2024, TARGET_2026]);
    for (const target of EE_TARGETS) {
      expect(loadCatalog(target.id).eeVersion).toBe(target.id);
    }
    expect(loadCatalog().eeVersion).toBe(TARGET_2026);
    // Same API reference does not mean same catalog: the engines differ.
    expect(Object.keys(loadCatalog(TARGET_2024).classes)).not.toEqual(
      Object.keys(loadCatalog(TARGET_2026).classes),
    );
  });

  it("refuses an unregistered version instead of falling back", () => {
    expect(() => loadCatalog("EE-2027.01.01")).toThrow(/not a verified EmptyEpsilon target/);
    expect(() => requireTarget("")).toThrow();
  });

  it("records provenance matching the committed catalog bytes", () => {
    const files: Record<string, string> = {
      [TARGET_2026]: join(catalogDir, "catalog.generated.json"),
      [TARGET_2024]: join(catalogDir, "targets", `${TARGET_2024}.json`),
    };
    for (const [target, file] of Object.entries(files)) {
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      expect(catalogProvenance(target).catalogSha256).toBe(digest);
    }
  });
});

describe("build against each target (offline; not an engine run)", () => {
  for (const target of [TARGET_2024, TARGET_2026]) {
    for (const id of PROJECTS) {
      it(`${id} builds for ${target}`, () => {
        const { project, raw } = readProject(id);
        const result = buildProject(loadCatalog(target), withTarget(project, target), {
          sourceHash: createHash("sha256").update(raw).digest("hex"),
          extensions: [echoExtension],
        });
        expect(result.files.length).toBeGreaterThanOrEqual(3);
        const scenario = result.files.find((f) => f.name.startsWith("scenario_"));
        expect(scenario?.contents).toContain(`-- target  ${target}`);
      });
    }
  }
});

describe("project / catalog / library coherence", () => {
  const { project } = readProject("forge_demo");
  const opts = { sourceHash: "t", extensions: [echoExtension] };

  it("rejects a 2024 project built with the 2026 catalog", () => {
    expect(() => buildProject(loadCatalog(TARGET_2026), withTarget(project, TARGET_2024), opts)).toThrow(
      /targets EE-2024\.12\.08 but the API catalog is for EE-2026\.09\.22PR/,
    );
  });

  it("rejects a project that names an unverified version", () => {
    expect(() => buildProject(loadCatalog(), withTarget(project, "EE-2027.01.01"), opts)).toThrow(
      CodegenError,
    );
  });

  it("rejects a library scanned from another engine", () => {
    const library = { eeVersion: TARGET_2026 } as unknown as EELibrary;
    expect(() =>
      buildProject(loadCatalog(TARGET_2024), withTarget(project, TARGET_2024), { ...opts, library }),
    ).toThrow(/scanned library is from EE-2026\.09\.22PR/);
  });

  it("refuses API that the selected catalog does not have", () => {
    // getFactionInfo exists as a global in 2024 only.
    expect(renderGlobalCall(loadCatalog(TARGET_2024), "getFactionInfo", [str("Human Navy")])).toContain(
      "getFactionInfo",
    );
    expect(() => renderGlobalCall(loadCatalog(TARGET_2026), "getFactionInfo", [str("Human Navy")])).toThrow(
      /does not exist in EE-2026\.09\.22PR/,
    );
  });
});

describe("install detection", () => {
  it("returns null for an unrecognised or empty install", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-detect-"));
    try {
      expect(detectInstallTarget(dir)).toBeNull();
      writeFileSync(join(dir, "script_reference.html"), "<html>some future build</html>");
      expect(detectInstallTarget(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const installs: Array<[string, string]> = [
    [TARGET_2024, "/mnt/c/Win32_EmptyEpsilon_EE-2024.12.08/EmptyEpsilon"],
    [TARGET_2026, "/mnt/c/EE_2026/EmptyEpsilon"],
  ];
  for (const [target, path] of installs) {
    it.skipIf(!existsSync(join(path, "script_reference.html")))(
      `recognises ${target} from its own reference`,
      () => {
        expect(detectInstallTarget(path)).toBe(target);
      },
    );
  }
});

/**
 * Runs the emitted set_dialogue against hand-made objects in a plain Lua
 * VM. This proves the generated code reads the right fields for each
 * engine's object model; it does not prove EE behaves as the mock does.
 */
describe("set_dialogue restores the default comms script per target (mock Lua)", () => {
  const names = runtimeNames("probe");
  const probe = (flavour: "typeName" | "ecs", object: string): { ok: boolean; out: string } => {
    const dir = mkdtempSync(join(tmpdir(), "forge-lua-"));
    try {
      const file = join(dir, "t.lua");
      writeFileSync(
        file,
        `${luaRuntime(names, flavour)}
local script = nil
local o = ${object}
o.setCommsFunction = function() end
o.setCommsScript = function(_, s) script = s end
o.isValid = function() return true end
${names.rt}.alive = function() return true end
${names.rt}.set_dialogue({ o }, nil)
return script
`,
      );
      const run = spawnSync("python3", [join(here, "fixtures", "run-lua.py"), file], { encoding: "utf8" });
      if (run.status === 2) return { ok: false, out: "SKIP" };
      return { ok: run.status === 0, out: (run.status === 0 ? run.stdout : run.stderr).trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const station2024 = `{ typeName = "SpaceStation" }`;
  const ship2024 = `{ typeName = "CpuShip" }`;
  const station2026 = `{ components = { docking_bay = {}, physics = { type = "static" } } }`;
  const ship2026 = `{ components = { physics = { type = "dynamic" } } }`;

  const available = spawnSync("python3", [join(here, "fixtures", "run-lua.py"), "/dev/null"]).status !== 2;

  it.skipIf(!available)("2024 flavour classifies by typeName", () => {
    expect(probe("typeName", station2024)).toEqual({ ok: true, out: "comms_station.lua" });
    expect(probe("typeName", ship2024)).toEqual({ ok: true, out: "comms_ship.lua" });
  });

  it.skipIf(!available)("2026 flavour classifies by ECS components", () => {
    expect(probe("ecs", station2026)).toEqual({ ok: true, out: "comms_station.lua" });
    expect(probe("ecs", ship2026)).toEqual({ ok: true, out: "comms_ship.lua" });
  });

  it.skipIf(!available)("the ECS branch cannot run on a 2024 object (the bug this fixes)", () => {
    expect(probe("ecs", station2024).ok).toBe(false);
  });

  it("the build picks the flavour from the project's target", () => {
    const { project } = readProject("forge_demo");
    const scenario = (target: string): string => {
      const built = buildProject(loadCatalog(target), withTarget(project, target), { sourceHash: "t", extensions: [echoExtension] });
      return built.files.find((f) => f.name.startsWith("scenario_"))?.contents ?? "";
    };
    const lua2024 = scenario(TARGET_2024);
    const lua2026 = scenario(TARGET_2026);
    expect(lua2024).toContain('o.typeName == "SpaceStation"');
    expect(lua2024).not.toContain("o.components.docking_bay");
    expect(lua2026).toContain("o.components.docking_bay");
    expect(lua2026).not.toContain("o.typeName");
  });
});
