import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type EEProject } from "@forge/contracts";
import { importProject } from "../src/project/migrate.js";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { diagnose, plannedBundle, problemsFor, sortProblems } from "../src/editor/index.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (id: string): EEProject => importProject(JSON.parse(readFileSync(join(repo, "projects", id, "project.json"), "utf8"))).project;
const demo = (): EEProject => load("forge_demo");
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Does the real build accept it, in this mode? */
function buildRefuses(project: EEProject, mode: "vanilla" | "integrated" = "vanilla"): boolean {
  try {
    buildProject(loadCatalog(project.eeVersion), project, { sourceHash: "x", mode });
    return false;
  } catch {
    return true;
  }
}
const errors = (p: EEProject, mode: "vanilla" | "integrated" = "vanilla") => problemsFor(diagnose(p, { mode }), mode).filter((x) => x.severity === "error");

describe("the problem list agrees with the build", () => {
  for (const id of ["forge_demo", "exodus_optional_demo"]) {
    it(`${id}: no blocking problem exactly when the vanilla build accepts it`, () => {
      const p = load(id);
      expect(errors(p).length > 0).toBe(buildRefuses(p));
    });
  }

  for (const id of ["forge_demo", "exodus_optional_demo"]) {
    it(`${id}: as many warnings as the build gives`, () => {
      const p = load(id);
      const built = buildProject(loadCatalog(p.eeVersion), p, { sourceHash: "x", mode: "vanilla" });
      expect(problemsFor(diagnose(p, { mode: "vanilla" }), "vanilla").filter((x) => x.severity === "warning")).toHaveLength(built.warnings.length);
    });
  }

  const mutations: Array<[string, string, (p: EEProject) => void]> = [
    ["a group filed under a sector that does not exist", "dangling-sector", (p) => { p.map.groups[0]!.sector = "nowhere"; }],
    ["two sectors with one id", "duplicate-sector", (p) => { p.map.sectors.push({ ...p.map.sectors[0]! }); }],
    ["duplicate group", "duplicate-group", (p) => p.map.groups.push(clone(p.map.groups[0]!))],
    ["template without a model", "template-no-model", (p) => { p.templates[0]!.model = null; p.templates[0]!.copyOf = null; }],
    ["dangling marker", "dangling-marker", (p) => { p.logic.beats.push({ id: "b9", label: "B9", at: 5, actions: [{ kind: "spawn_group", groupId: p.map.groups[0]!.id }] } as never); (p.map.groups[0]!.objects[0] as never as { position: unknown }).position = { ref: "marker", markerId: "ghost" }; }],
    ["a dialogue that jumps nowhere", "dialogue-broken-jump", (p) => { p.logic.dialogues = [{ id: "d", label: "D", entry: "n1", nodes: [{ id: "n1", text: "x", replies: [{ text: "go", target: { kind: "node", nodeId: "gone" }, conditions: [], actions: [] }] }] }] as never; }],
    ["an object with an unknown dialogue", "object-unknown-dialogue", (p) => { (p.map.groups[0]!.objects.find((o) => o.type === "SpaceStation") as never as { dialogueId: string }).dialogueId = "nope"; }],
    ["a planet orbiting nothing", "orbit-unknown", (p) => { const planet = p.map.groups.flatMap((g) => g.objects).find((o) => o.type === "Planet") as never as { orbit: unknown }; planet.orbit = { targetId: "ghost", distance: 1000, period: 60, phase: 0 }; }],
    ["an EXODUS action naming a missing step", "step-missing", (p) => { p.logic.beats.push({ id: "bx", label: "BX", at: 5, actions: [{ kind: "exodus_hail", target: { ref: "player" }, text: "x", stepId: "nostep" }] } as never); }],
  ];
  for (const [name, code, mutate] of mutations) {
    it(`${name}: reported (${code}) and refused by the build`, () => {
      const p = clone(demo());
      mutate(p);
      expect(errors(p).map((x) => x.code)).toContain(code);
      expect(buildRefuses(p)).toBe(true);
    });
  }
});

describe("every problem says what, how bad, why, what to do and where", () => {
  it("fills severity, subject, title, message and action, and points somewhere when it can", () => {
    const p = clone(demo());
    p.templates[0]!.model = null;
    p.templates[0]!.copyOf = null;
    const list = diagnose(p);
    const t = list.find((x) => x.code === "template-no-model")!;
    expect(t).toMatchObject({ severity: "error", subject: expect.stringContaining(p.templates[0]!.name), where: { kind: "template", field: "model" } });
    for (const x of list) {
      expect(x.title).not.toBe("");
      expect(x.message).not.toBe("");
      expect(x.action).not.toBe("");
    }
  });
  it("keeps one stable id per problem, and puts errors first", () => {
    const p = clone(demo());
    p.logic.rules.push({ id: "g", label: "G", once: true, when: { kind: "variable_at_least", name: "zzz", value: 1 }, conditions: [], actions: [] } as never);
    p.templates[0]!.model = null;
    p.templates[0]!.copyOf = null;
    const list = sortProblems(diagnose(p));
    expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    expect(list[0]!.severity).toBe("error");
    expect(list.map((x) => x.severity).join()).toMatch(/^(error,)+(warning,?)+$/);
  });
  it("calls a name 'not checked' — not 'not found' — when no install is scanned", () => {
    const p = clone(demo());
    p.templates[0]!.model = "nope_model";
    const none = diagnose(p, { library: null }).find((x) => x.code.startsWith("model-"))!;
    expect(none.code).toBe("model-unchecked");
    const scanned = diagnose(p, { library: { eeVersion: p.eeVersion, installPath: "/x", scannedAt: "2026-10-01", templates: [], models: [], factions: [], resources: { radarTraces: [], planetTextures: [], meshes: [], textures: [], sounds: [], packs: [] }, warnings: [] } }).find((x) => x.code.startsWith("model-"))!;
    expect(scanned.code).toBe("model-unknown");
  });
});

describe("EXODUS steps: the alternatives still to write, listed together", () => {
  const withUndecided = (): EEProject => {
    const p = clone(load("exodus_optional_demo"));
    for (const s of p.logic.exodusSteps) s.alternative = null;
    return p;
  };
  it("lists each undecided step as its own blocking problem in a vanilla export, with a place to go", () => {
    const p = withUndecided();
    const list = diagnose(p, { mode: "vanilla" }).filter((x) => x.code === "step-undecided" || x.code === "step-none");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x) => x.severity === "error" && x.where !== null)).toBe(true);
    expect(buildRefuses(p, "vanilla")).toBe(true);
  });
  it("makes the same steps warnings, not blockers, in an integrated export", () => {
    const list = diagnose(withUndecided(), { mode: "integrated", extensionAvailable: true }).filter((x) => x.code === "step-undecided" || x.code === "step-none");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x) => x.severity === "warning")).toBe(true);
  });
  it("says an integrated export cannot be built when no extension is available", () => {
    const list = diagnose(withUndecided(), { mode: "integrated", extensionAvailable: false });
    expect(list.some((x) => x.code === "extension-missing" && x.severity === "error")).toBe(true);
  });
});

describe("the planned bundle", () => {
  for (const id of ["forge_demo", "exodus_optional_demo"]) {
    it(`${id}: names exactly the files the build writes`, () => {
      const p = load(id);
      const built = buildProject(loadCatalog(p.eeVersion), p, { sourceHash: "x", mode: "vanilla" });
      expect(plannedBundle(p).map((f) => `${f.kind}:${f.name}`).sort()).toEqual(built.files.map((f) => `${f.install}:${f.name}`).sort());
    });
  }
});
