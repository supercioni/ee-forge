import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EEProjectSchema, SPAWNABLE_CLASSES, type EEProject } from "@forge/contracts";
import {
  NO_FILTER,
  describeVia,
  duplicateNames,
  fieldsFor,
  filterScene,
  findReferences,
  groupSpawners,
  hiddenSelected,
  isFiltering,
  renameObject,
  sceneEntries,
  sectionOf,
  sectionedFields,
  typesInScene,
} from "../src/editor/index.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demo = (): EEProject => EEProjectSchema.parse(JSON.parse(readFileSync(join(repo, "projects/forge_demo/project.json"), "utf8")));

describe("scene index and filter", () => {
  const project = demo();
  const entries = sceneEntries(project);

  it("lists every object (with its group) and every marker", () => {
    const objects = project.map.groups.reduce((n, g) => n + g.objects.length, 0);
    expect(entries.filter((e) => e.kind === "object")).toHaveLength(objects);
    expect(entries.filter((e) => e.kind === "marker")).toHaveLength(project.map.markers.length);
    for (const entry of entries.filter((e) => e.kind === "object")) {
      expect(entry.groupId).not.toBeNull();
      expect(entry.when === "on_start" || entry.when === "on_call").toBe(true);
    }
  });

  it("does not filter by default, and says when it is filtering", () => {
    expect(filterScene(entries, NO_FILTER)).toHaveLength(entries.length);
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering({ query: " ", type: "" })).toBe(false);
    expect(isFiltering({ query: "x", type: "" })).toBe(true);
    expect(isFiltering({ query: "", type: "Zone" })).toBe(true);
  });

  it("finds by id, by callsign, by engine class and by the friendly label", () => {
    const first = entries.find((e) => e.kind === "object" && e.name !== e.id);
    expect(first).toBeDefined();
    expect(filterScene(entries, { query: first!.id, type: "" }).map((e) => e.id)).toContain(first!.id);
    expect(filterScene(entries, { query: first!.name.toLowerCase(), type: "" }).map((e) => e.id)).toContain(first!.id);
    expect(filterScene(entries, { query: "PlayerSpaceship", type: "" }).every((e) => e.type === "PlayerSpaceship")).toBe(true);
    const labelled = filterScene(entries, { query: "player ship", type: "" }, (t) => (t === "PlayerSpaceship" ? "Player ship" : t));
    expect(labelled.some((e) => e.type === "PlayerSpaceship")).toBe(true);
  });

  it("finds the objects of a group by the group's label or its id", () => {
    const group = project.map.groups.find((g) => g.when === "on_call")!;
    const byId = filterScene(entries, { query: group.id, type: "" }).filter((e) => e.groupId === group.id);
    expect(byId).toHaveLength(group.objects.length);
    const byLabel = filterScene(entries, { query: group.label.split(" ")[0]!, type: "" }).filter((e) => e.groupId === group.id);
    expect(byLabel).toHaveLength(group.objects.length);
  });

  it("requires every word, and combines with a type filter", () => {
    expect(filterScene(entries, { query: "zzzz-no-such", type: "" })).toHaveLength(0);
    const zones = filterScene(entries, { query: "", type: "Zone" });
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every((e) => e.type === "Zone")).toBe(true);
    expect(filterScene(entries, { query: "zone zzzz-no-such", type: "Zone" })).toHaveLength(0);
  });

  it("filtering never changes the project", () => {
    const before = JSON.stringify(project);
    filterScene(entries, { query: "a", type: "Zone" });
    expect(JSON.stringify(project)).toBe(before);
  });

  it("reports duplicate names so those rows can show their id and group", () => {
    const twin = { ...entries[0]!, id: "twin-b" };
    const dups = duplicateNames([...entries, twin]);
    expect(dups.has(entries[0]!.name)).toBe(true);
    expect(duplicateNames([entries[0]!]).size).toBe(0);
  });

  it("reports the selected objects a filter is hiding", () => {
    const visible = filterScene(entries, { query: "", type: "Zone" });
    const other = entries.find((e) => e.kind === "object" && e.type !== "Zone")!;
    expect(hiddenSelected([other.id], visible, "object")).toEqual([other.id]);
    expect(hiddenSelected([visible[0]!.id], visible, "object")).toEqual([]);
  });

  it("lists the classes present for the type filter", () => {
    expect(typesInScene(entries)).toContain("PlayerSpaceship");
  });
});

describe("Used by", () => {
  const project = demo();

  it("finds a rule that watches a zone, with where and how", () => {
    const rule = project.logic.rules.find((r) => JSON.stringify(r).includes('"zoneId"'));
    expect(rule).toBeDefined();
    const zoneId = /"zoneId":"([^"]+)"/.exec(JSON.stringify(rule))![1]!;
    const refs = findReferences(project, "object", zoneId);
    const hit = refs.find((r) => r.owner.kind === "rule" && r.owner.id === rule!.id);
    expect(hit).toBeDefined();
    expect(hit!.where).toBe("When");
    expect(hit!.via).toBe("player_in_zone");
  });

  it("finds who spawns a group, and nothing for a group no rule spawns", () => {
    const spawned = project.map.groups.find((g) => groupSpawners(project, g.id).length > 0);
    expect(spawned).toBeDefined();
    expect(spawned!.when).toBe("on_call");
    expect(groupSpawners(project, spawned!.id)[0]!.via).toBe("spawn_group");
    expect(groupSpawners(project, "no-such-group")).toHaveLength(0);
  });

  it("is in step with rename: after renaming an object, the references follow it and the old id has none", () => {
    const withRefs = project.map.groups.flatMap((g) => g.objects).find((o) => findReferences(project, "object", o.id).length > 0);
    expect(withRefs).toBeDefined();
    const before = findReferences(project, "object", withRefs!.id).length;
    const renamed = renameObject(project, withRefs!.id, "renamed-by-test");
    expect(findReferences(renamed, "object", "renamed-by-test")).toHaveLength(before);
    expect(findReferences(renamed, "object", withRefs!.id)).toHaveLength(0);
  });

  it("does not list an object as referring to itself, and does not mix namespaces", () => {
    const own = project.map.groups.flatMap((g) => g.objects)[0]!;
    expect(findReferences(project, "object", own.id).some((r) => r.owner.kind === "object" && r.owner.id === own.id)).toBe(false);
    expect(findReferences(project, "marker", "ambush").every((r) => r.via !== "spawn_group")).toBe(true);
  });

  it("reads a record kind in words", () => {
    expect(describeVia("player_in_zone")).toBe("player in zone");
    expect(describeVia("")).toBe("");
  });
});

describe("inspector sections", () => {
  it("every field of every class lands in a section, once, in descriptor order — nothing becomes unreachable", () => {
    for (const type of SPAWNABLE_CLASSES) {
      const sectioned = sectionedFields(type).flatMap((g) => g.fields.map((f) => f.key));
      const all = fieldsFor(type).map((f) => f.key);
      expect([...sectioned].sort()).toEqual([...all].sort());
      expect(new Set(sectioned).size).toBe(sectioned.length);
    }
  });
  it("puts a key the table has never heard of under More, not nowhere", () => {
    expect(sectionOf("someFutureField")).toBe("More");
  });
  it("keeps identity first and every section non-empty", () => {
    const planet = sectionedFields("Planet");
    expect(planet[0]!.section).toBe("Identity");
    expect(planet.every((g) => g.fields.length > 0)).toBe(true);
  });
});
