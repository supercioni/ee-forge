import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "@forge/contracts";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import {
  ProjectImportError,
  importProject,
  migrateProjectDocument,
  preserveUnmodelled,
  serializeProject,
} from "../src/project/migrate.js";
import { echoExtension } from "./fixtures/echo-extension.js";
import { TARGET_2024, TARGET_2026 } from "../src/targets.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const PROJECTS = ["forge_demo"];

// Work on copies only: the originals under projects/ are never opened for writing.
const sandbox = mkdtempSync(join(tmpdir(), "forge-migrate-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function copyOf(id: string): { dir: string; raw: string } {
  const dir = join(sandbox, id);
  mkdirSync(dir, { recursive: true });
  cpSync(join(repoRoot, "projects", id, "project.json"), join(dir, "project.json"));
  return { dir, raw: readFileSync(join(dir, "project.json"), "utf8") };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Resolve a `pointer()` key (`a.b[id].c`) against the original document. */
function valueAt(document: unknown, key: string): unknown {
  let node: unknown = document;
  for (const part of key.match(/[^.[\]]+|\[[^\]]+\]/g) ?? []) {
    if (part.startsWith("[")) {
      const id = part.slice(1, -1);
      const list = node as Array<Record<string, unknown>>;
      node = list.find((item) => item["id"] === id) ?? list[Number(id)];
    } else {
      node = (node as Record<string, unknown>)[part];
    }
  }
  return node;
}

/** Same JSON value, keys in reverse order at every level. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  }
  return value;
}

describe.each(PROJECTS)("project %s", (id) => {
  const { raw } = copyOf(id);
  const source = JSON.parse(raw) as Record<string, unknown>;

  it("is an unversioned (v0) document that migrates to the current version", () => {
    const migrated = migrateProjectDocument(source);
    expect(migrated.fromVersion).toBe(0);
    expect(migrated.toVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.applied).toEqual(["0001-add-schema-version", "0002-exodus-steps", "0003-sectors", "0004-start-sector", "0005-campaign-persistence"]);
  });

  it("loses no field: unmodelled keys are carried verbatim, nothing is dropped", () => {
    const imported = importProject(source);
    expect(imported.lost).toEqual([]);
    // Each carried value equals what the source held at that path.
    for (const key of imported.preserved) {
      const value = imported.project.unmodelled[key];
      expect(value, key).not.toBeUndefined();
      expect(value, key).toEqual(valueAt(source, key));
    }
    expect(Object.keys(imported.project.unmodelled).sort()).toEqual([...imported.preserved].sort());
    // Top level: the source's keys, plus the three the format adds.
    expect(Object.keys(imported.project).sort()).toEqual(
      [...Object.keys(source), "schemaVersion", "unmodelled", "campaign"].filter((k, i, all) => all.indexOf(k) === i).sort(),
    );
  });

  it("is idempotent and deterministic", () => {
    const once = serializeProject(importProject(source).project);
    const again = importProject(JSON.parse(once));
    expect(again.applied).toEqual([]);
    expect(again.fromVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(serializeProject(again.project)).toBe(once);
    expect(serializeProject(importProject(source).project)).toBe(once);
    // Carried fields are stored key-sorted, so their bytes do not depend on
    // the order the source file happened to use. (Free-form action payloads
    // elsewhere keep the order they arrived in.)
    expect(JSON.stringify(importProject(reverseKeys(source)).project.unmodelled)).toBe(
      JSON.stringify(importProject(source).project.unmodelled),
    );
  });

  it("preserves the generated bundles on both targets", () => {
    const migrated = importProject(source).project;
    for (const target of [TARGET_2024, TARGET_2026]) {
      const catalog = loadCatalog(target);
      const options = { sourceHash: sha(raw), extensions: [echoExtension] };
      const before = buildProject(catalog, { ...importProject(source).project, eeVersion: target }, options);
      const after = buildProject(
        catalog,
        { ...importProject(JSON.parse(serializeProject(migrated))).project, eeVersion: target },
        options,
      );
      expect(after.files).toEqual(before.files);
      expect(after.warnings).toEqual(before.warnings);
    }
  });
});

describe("import safety", () => {
  const base = JSON.parse(copyOf("forge_demo").raw) as Record<string, unknown>;

  it("keeps fields the schema does not model instead of stripping them", () => {
    const withExtra = { ...base, futureField: { a: 1 } };
    const imported = importProject(withExtra);
    expect(imported.preserved).toEqual(["futureField"]);
    expect(imported.project.unmodelled["futureField"]).toEqual({ a: 1 });
    expect(imported.lost).toEqual([]);
    // Importing the saved result again changes nothing (idempotent).
    const again = importProject(JSON.parse(serializeProject(imported.project)));
    expect(again.preserved).toEqual([]);
    expect(serializeProject(again.project)).toBe(serializeProject(imported.project));
  });

  it("refuses a document from a newer schema instead of downgrading it", () => {
    expect(() => importProject({ ...base, schemaVersion: PROJECT_SCHEMA_VERSION + 1 })).toThrow(
      ProjectImportError,
    );
  });

  it("rejects malformed input with a readable message", () => {
    expect(() => importProject([])).toThrow(/JSON object/);
    expect(() => importProject({ ...base, schemaVersion: "1" })).toThrow(/schemaVersion/);
    expect(() => importProject({ ...base, name: 3 })).toThrow(/invalid project document: name/);
  });
});

describe("forge:migrate CLI", () => {
  it("writes a migrated copy and leaves the source byte-identical", () => {
    const { dir, raw } = copyOf("forge_demo");
    const out = join(sandbox, "forge_demo-v1");
    const run = spawnSync("npx", ["tsx", join(here, "..", "src", "cli.ts"), "migrate", dir, "--out", out], {
      encoding: "utf8",
      cwd: join(here, ".."),
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`schema v0 → v${PROJECT_SCHEMA_VERSION}`);
    expect(sha(readFileSync(join(dir, "project.json"), "utf8"))).toBe(sha(raw));
    const copy = JSON.parse(readFileSync(join(out, "project.json"), "utf8")) as Record<string, unknown>;
    expect(copy["schemaVersion"]).toBe(PROJECT_SCHEMA_VERSION);
    expect(copy["unmodelled"]).toEqual({});
  });

  it("is a dry run without --out and refuses to target the source directory", () => {
    const { dir, raw } = copyOf("forge_demo");
    const cli = join(here, "..", "src", "cli.ts");
    const dry = spawnSync("npx", ["tsx", cli, "migrate", dir], { encoding: "utf8", cwd: join(here, "..") });
    expect(dry.stdout).toContain("dry run");
    const same = spawnSync("npx", ["tsx", cli, "migrate", dir, "--out", dir], {
      encoding: "utf8",
      cwd: join(here, ".."),
    });
    expect(same.status).not.toBe(0);
    expect(readFileSync(join(dir, "project.json"), "utf8")).toBe(raw);
  });
});

