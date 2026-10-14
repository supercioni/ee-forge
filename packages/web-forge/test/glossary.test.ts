import { SPAWNABLE_CLASSES } from "@forge/contracts";
import { describe, expect, it } from "vitest";
import { GROUP_WHEN, LOGIC_WORDS, MISSION_TABS, SIMULATION_SCOPE, VIEW_HINTS, VIEW_LABELS, objectTypeLabel } from "../src/ui/glossary.js";

describe("the editor's vocabulary", () => {
  it("names every class the palette can place, and never leaks a CamelCase engine name", () => {
    for (const type of SPAWNABLE_CLASSES) {
      const label = objectTypeLabel(type);
      expect(label, type).not.toMatch(/[a-z][A-Z]/);
      expect(label.length).toBeGreaterThan(0);
    }
  });
  it("shows an unknown class as the engine spells it, rather than inventing a name", () => {
    expect(objectTypeLabel("SomethingNew")).toBe("SomethingNew");
  });
  it("gives every view a label and a tooltip, with no two views sharing a label", () => {
    const ids = Object.keys(VIEW_LABELS);
    expect(Object.keys(VIEW_HINTS).sort()).toEqual([...ids].sort());
    expect(new Set(Object.values(VIEW_LABELS)).size).toBe(ids.length);
  });
  it("keeps the project's own keys for a group's timing", () => {
    expect(GROUP_WHEN.map((w) => w.value)).toEqual(["on_start", "on_call"]);
  });
  it("is English: no accented letters in any label", () => {
    const all = [...Object.values(VIEW_LABELS), ...Object.values(VIEW_HINTS), ...SPAWNABLE_CLASSES.map(objectTypeLabel), ...GROUP_WHEN.flatMap((w) => [w.label, w.detail])];
    for (const text of all) expect(text).not.toMatch(/[àèéìòùÀÈÉÌÒÙ]/);
  });

  it("Mission has six sections with distinct ids and labels, in the order the view shows them", () => {
    expect(MISSION_TABS.map((t) => t.label)).toEqual(["Rules", "Timeline", "GM controls", "Variables", "Diagram", "Campaign"]);
    expect(new Set(MISSION_TABS.map((t) => t.id)).size).toBe(MISSION_TABS.length);
  });
  it("calls a beat a timed event and a GM button a GM control, and never uses the old words", () => {
    expect(LOGIC_WORDS.beat).toBe("Timed event");
    expect(LOGIC_WORDS.gmButton).toBe("GM control");
    for (const word of Object.values(LOGIC_WORDS)) expect(word).not.toMatch(/beat|button|guard|dry run/i);
  });
  it("says what the simulation does not do", () => {
    expect(SIMULATION_SCOPE).toMatch(/does not simulate EmptyEpsilon's combat, movement, AI or physics/);
    expect(SIMULATION_SCOPE).toMatch(/GM controls are not pressed/);
  });
});
