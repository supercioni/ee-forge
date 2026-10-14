import { emptyEEProject, EEProjectSchema, type EEProject } from "@forge/contracts";
import { NO_VIEW_PREFS } from "@forge/core/editor";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "../src/store/editor.js";

(globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: () => null, setItem: () => undefined } };
const get = () => useEditor.getState();

function project(): EEProject {
  const base = emptyEEProject("camp", "Camp");
  return { ...base, map: { ...base.map, sectors: [{ id: "a", label: "System A" }], startSector: "a" } };
}

beforeEach(() => {
  useEditor.setState({ project: project(), dirty: false, revision: 0, viewPrefs: NO_VIEW_PREFS, logicSelection: null });
});

describe("campaign saves in the store (ADR-0058)", () => {
  it("a project starts with campaign saves off", () => {
    expect(get().project?.campaign.persistence).toBe(false);
  });

  it("turning them on changes the document, marks the project unsaved and says what it means", () => {
    get().setCampaignPersistence(true);
    expect(get().project?.campaign.persistence).toBe(true);
    expect(get().dirty).toBe(true);
    expect(get().status).toMatch(/Campaign saves are on/);
    expect(EEProjectSchema.parse(get().project).campaign.persistence).toBe(true); // the document round-trips
  });

  it("asking for what it already is changes nothing (no phantom edit)", () => {
    get().setCampaignPersistence(false);
    expect(get().dirty).toBe(false);
  });

  it("turning them off again says nothing is kept", () => {
    get().setCampaignPersistence(true);
    get().setCampaignPersistence(false);
    expect(get().project?.campaign.persistence).toBe(false);
    expect(get().status).toMatch(/Campaign saves are off/);
  });

  it("a new timed event and a new rule are global (sector null) until the author scopes them", () => {
    get().addBeat(10);
    get().addRule();
    const p = get().project;
    expect(p?.logic.beats[0]?.sector).toBeNull();
    expect(p?.logic.rules[0]?.sector).toBeNull();
    const beatId = p?.logic.beats[0]?.id ?? "";
    get().updateBeat(beatId, { sector: "a" });
    expect(get().project?.logic.beats[0]?.sector).toBe("a");
  });
});
