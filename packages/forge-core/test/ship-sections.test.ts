import { describe, expect, it } from "vitest";
import { TEMPLATE_FIELDS, TEMPLATE_SECTIONS, searchTemplateFields, sectionOfField, templateSections } from "../src/editor/index.js";

describe("the ship form in sections", () => {
  it("has the five sections an author thinks in", () => {
    expect(TEMPLATE_SECTIONS.map((s) => s.label)).toEqual(["Identity", "Hull", "Movement", "Weapons", "Interior"]);
  });
  it("reaches every descriptor exactly once", () => {
    const keys = templateSections().flatMap((s) => s.blocks.flatMap(([, specs]) => specs.map((spec) => spec.key)));
    expect(keys.sort()).toEqual(TEMPLATE_FIELDS.map((f) => f.key).sort());
  });
  it("puts a group the table does not name in the last section instead of dropping it", () => {
    expect(sectionOfField({ key: "x", label: "X", widget: "text", nullable: true, group: "Brand new" })).toBe("interior");
  });
  it("keeps beams with Weapons and rooms with Interior", () => {
    const where = (key: string): string => sectionOfField(TEMPLATE_FIELDS.find((f) => f.key === key)!);
    expect(where("beams")).toBe("weapons");
    expect(where("rooms")).toBe("interior");
    expect(where("doors")).toBe("interior");
    expect(where("hull")).toBe("hull");
    expect(where("warpSpeed")).toBe("movement");
  });
});

describe("searching properties", () => {
  it("finds a field by its label, key or EE method, in its section", () => {
    expect(searchTemplateFields("beams", null).map((m) => m.spec.key)).toContain("beams");
    expect(searchTemplateFields("setRadarTrace", null).map((m) => m.spec.key)).toEqual(["radarTrace"]);
    expect(searchTemplateFields("radar trace", null)[0]?.section).toBe("hull");
  });
  it("needs every word to match", () => {
    expect(searchTemplateFields("warp speed", null).map((m) => m.spec.key)).toContain("warpSpeed");
    expect(searchTemplateFields("warp zzzz", null)).toEqual([]);
  });
  it("looks in the help text only when no field is named like the query", () => {
    const byName = searchTemplateFields("radar", null);
    expect(byName.every((m) => m.via === "name")).toBe(true);
    const byHelp = searchTemplateFields("pickers", null);
    expect(byHelp.map((m) => m.spec.key)).toContain("hidden");
    expect(byHelp.every((m) => m.via === "help")).toBe(true);
  });
  it("answers nothing for an empty query and for a word nothing has", () => {
    expect(searchTemplateFields("   ", null)).toEqual([]);
    expect(searchTemplateFields("qqqqq", null)).toEqual([]);
  });
});
