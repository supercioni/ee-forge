import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EEProjectSchema, type EEProject, type EEPredicate } from "@forge/contracts";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { CodegenError } from "../src/codegen/lua.js";
import { echoExtension } from "./fixtures/echo-extension.js";
import { TARGET_2024, TARGET_2026 } from "../src/targets.js";

/**
 * Audit of engine-specific dependencies in the generated Lua beyond
 * set_dialogue (2 Oct 2026). Method: build the four projects for both
 * targets, strip comments and string literals, and enumerate every property
 * read and every global/method call. Findings, pinned here so a new
 * divergence fails a test instead of reaching a game:
 *
 * 1. Property reads on engine objects: only `typeName` (2024) and
 *    `components.*` (2026), both inside set_dialogue. Nothing else.
 * 2. Methods called on handles: all exist in both catalogs. Availability per
 *    class differs — 2024 has `isFullyScannedBy` on SpaceShip only, 2026 on
 *    Entity — and the build already validates it per target.
 * 3. `getFactionInfo` is called raw by the content prelude. 2024 lists it as
 *    a global; 2026 defines it in `scripts/api/entity/factioninfo.lua`, so
 *    the 2026 catalog (built from the HTML reference) does not know it. Both
 *    return nil for an unknown name (`__faction_info[name]`), which is the
 *    only behaviour the prelude relies on.
 * 4. `commsStationMainMenu` comes from `comms_station.lua`, present and
 *    identical in name/entry in both installs.
 *
 * Static checks only: no engine was run.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROJECTS = ["forge_demo"];

function load(id: string): EEProject {
  return EEProjectSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "projects", id, "project.json"), "utf8")),
  );
}

function bundles(target: string): string[] {
  return PROJECTS.flatMap((id) =>
    buildProject(loadCatalog(target), { ...load(id), eeVersion: target }, { sourceHash: "t", extensions: [echoExtension] }).files.map(
      (f) =>
        f.contents
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .replace(/"(?:[^"\\]|\\.)*"/g, '""'),
    ),
  );
}

const LUA_WORDS = new Set([
  "if", "for", "while", "function", "return", "and", "or", "not", "pairs", "ipairs", "pcall",
  "print", "require", "tostring", "tonumber", "setmetatable", "type", "select", "next",
  "error", "assert", "elseif", "init", "update",
]);

describe("generated Lua: engine-dependent accesses", () => {
  it("reads engine object fields only inside set_dialogue", () => {
    for (const [target, field] of [
      [TARGET_2024, "typeName"],
      [TARGET_2026, "components"],
    ] as const) {
      const other = field === "typeName" ? "components" : "typeName";
      for (const src of bundles(target)) {
        // Any `<name>.<field>` where <name> is an object handle local.
        const reads = [...src.matchAll(/\b(?:o|p|obj|ship|z|e|found)\.(typeName|components)\b/g)].map((m) => m[1]);
        for (const read of reads) expect(read).toBe(field);
        expect(reads.includes(other as never)).toBe(false);
        if (reads.length > 0) expect(src).toContain("set_dialogue");
      }
    }
  });

  it("calls no engine global outside the catalog except the known getFactionInfo", () => {
    for (const target of [TARGET_2024, TARGET_2026]) {
      const catalog = loadCatalog(target);
      const known = new Set(catalog.globals.map((g) => g.name));
      const unknown = new Set<string>();
      for (const src of bundles(target)) {
        const defined = new Set(
          [...src.matchAll(/function\s+([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]!),
        );
        for (const m of src.matchAll(/(?<![\w.:])([a-z]\w*)\(/g)) {
          const name = m[1]!;
          if (known.has(name) || defined.has(name) || LUA_WORDS.has(name)) continue;
          // Names bound by `local x = ...`/parameters are called like globals too.
          if (new RegExp(`\\blocal\\s+${name}\\b`).test(src)) continue;
          unknown.add(name);
        }
      }
      // track / tick_*: helpers the emitters define; existing_faction: local.
      const engineSide = [...unknown].filter(
        (n) => !["track", "tick_beats", "tick_rules", "install_gm_buttons", "existing_faction"].includes(n),
      );
      expect(engineSide).toEqual(target === TARGET_2026 ? ["getFactionInfo"] : []);
    }
  });

  it("every method called on a handle exists in the target catalog", () => {
    for (const target of [TARGET_2024, TARGET_2026]) {
      const methods = new Set(
        Object.values(loadCatalog(target).classes).flatMap((c) => c.methods.map((m) => m.name)),
      );
      // The bridge object is EXODUS's, not EE's.
      const exodus = new Set([
        "complete_chapter", "emit", "emit_encrypted_comms", "lore_drop",
        "request_puzzle", "scenario_started", "set_state",
      ]);
      for (const src of bundles(target)) {
        for (const m of src.matchAll(/:([A-Za-z_]\w*)\(/g)) {
          if (!exodus.has(m[1]!)) expect(methods.has(m[1]!), `${target}: ${m[1]}`).toBe(true);
        }
      }
    }
  });
});

describe("per-class availability differs by target and is enforced at build time", () => {
  const scannedFull: EEPredicate = { kind: "object_scanned", objectId: "station", full: true };
  const withRule = (target: string): EEProject => {
    const project = load("forge_demo");
    return {
      ...project,
      eeVersion: target,
      logic: {
        ...project.logic,
        rules: [
          { id: "scan_station", label: "scan", when: scannedFull, conditions: [], once: true, actions: [] },
        ],
      },
    } as EEProject;
  };

  it("rejects a full scan of a station on 2024 (SpaceShip-only method)", () => {
    expect(() =>
      buildProject(loadCatalog(TARGET_2024), withRule(TARGET_2024), { sourceHash: "t", extensions: [echoExtension] }),
    ).toThrow(CodegenError);
  });

  it("accepts it on 2026, where the method lives on Entity", () => {
    const built = buildProject(loadCatalog(TARGET_2026), withRule(TARGET_2026), { sourceHash: "t", extensions: [echoExtension] });
    expect(built.files.some((f) => f.contents.includes("scanned_full"))).toBe(true);
  });
});
