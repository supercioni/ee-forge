import { describe, expect, it } from "vitest";
import type { EEAction, EELogic } from "@forge/contracts";
import {
  addAction,
  addStep,
  alternativeFor,
  nextStepId,
  patchAlternative,
  readRecord,
  removeStep,
  setStepChoice,
  setStepEssential,
  stepActions,
  vanillaReadiness,
  writeRecord,
} from "../src/editor/index.js";
import { starterProject } from "../src/editor/factories.js";
import { buildProject } from "../src/codegen/build.js";
import { loadCatalog } from "../src/catalog/load.js";
import { TARGET_2026 } from "../src/targets.js";

const lore = (stepId: string | null): EEAction => ({ kind: "exodus_lore", stepId, fragmentId: "f", foundBy: null });
const say: EEAction = { kind: "banner", text: "hello" };

function logicWith(actions: EEAction[]): EELogic {
  const base = starterProject("e", "E").logic;
  return { ...base, beats: [{ id: "b", label: "b", at: 0, actions }], rules: [], gmButtons: [], dialogues: [], exodusSteps: [] };
}

describe("editing the without-EXODUS record", () => {
  it("makes unique step ids", () => {
    let logic = addStep(logicWith([]), "lore");
    expect(nextStepId(logic, "lore")).toBe("lore_2");
    logic = addStep(logic, "lore_2");
    expect(nextStepId(logic, "lore")).toBe("lore_3");
    expect(addStep(logic, "lore").exodusSteps).toHaveLength(2); // never duplicates
  });

  it("a new step is undecided, and choosing keeps the actions already written", () => {
    let logic = addStep(logicWith([]), "s");
    expect(logic.exodusSteps[0]?.alternative).toBeNull();
    logic = setStepChoice(logic, "s", "immediate");
    logic = addAction(logic, { kind: "exodusStep", id: "s", list: "alternative" }, say);
    expect(stepActions(logic, "s", "alternative")).toEqual([say]);
    // immediate -> wait -> gm: the work is not thrown away; none -> back loses it by design.
    logic = setStepChoice(logic, "s", "wait");
    expect(stepActions(logic, "s", "alternative")).toEqual([say]);
    logic = setStepChoice(logic, "s", "gm");
    expect(stepActions(logic, "s", "alternative")).toEqual([say]);
    logic = setStepChoice(logic, "s", "none");
    expect(stepActions(logic, "s", "alternative")).toEqual([]);
    expect(setStepChoice(logic, "s", "undecided").exodusSteps[0]?.alternative).toBeNull();
  });

  it("only the fields a kind has can be patched; bad values are ignored", () => {
    let logic = setStepChoice(addStep(logicWith([]), "s"), "s", "wait");
    logic = patchAlternative(logic, "s", { seconds: 90, label: "ignored" });
    expect(logic.exodusSteps[0]?.alternative).toMatchObject({ kind: "wait", seconds: 90 });
    expect(patchAlternative(logic, "s", { seconds: -5 }).exodusSteps[0]?.alternative).toMatchObject({ seconds: 90 });
    logic = setStepChoice(logic, "s", "gm");
    logic = patchAlternative(logic, "s", { label: "Go", message: "m" });
    expect(logic.exodusSteps[0]?.alternative).toMatchObject({ kind: "gm", label: "Go", message: "m" });
    expect(patchAlternative(logic, "s", { label: "" }).exodusSteps[0]?.alternative).toMatchObject({ label: "Go" });
  });

  it("keeps EXODUS actions out of a step's lists", () => {
    let logic = setStepChoice(addStep(logicWith([]), "s"), "s", "immediate");
    logic = addAction(logic, { kind: "exodusStep", id: "s", list: "alternative" }, lore(null));
    logic = addAction(logic, { kind: "exodusStep", id: "s", list: "success" }, lore(null));
    expect(stepActions(logic, "s", "alternative")).toEqual([]);
    expect(stepActions(logic, "s", "success")).toEqual([]);
  });

  it("edits a step's action in place through the same path API as every other list", () => {
    let logic = setStepChoice(addStep(logicWith([]), "s"), "s", "immediate");
    const owner = { kind: "exodusStep", id: "s", list: "alternative" } as const;
    logic = addAction(logic, owner, say);
    const path = { owner, target: { slot: "action", index: 0 } } as const;
    expect(readRecord(logic, path)).toEqual(say);
    logic = writeRecord(logic, path, { kind: "banner", text: "changed" });
    expect(stepActions(logic, "s", "alternative")).toEqual([{ kind: "banner", text: "changed" }]);
  });

  it("deleting a step detaches its actions instead of breaking them", () => {
    let logic = addStep(logicWith([lore("s"), lore("other")]), "s");
    logic = removeStep(logic, "s");
    expect(logic.exodusSteps).toEqual([]);
    expect(logic.beats[0]?.actions).toEqual([lore(null), lore("other")]);
  });

  it("alternativeFor('undecided') is null — undecided is never stored as 'none'", () => {
    expect(alternativeFor("undecided")).toBeNull();
    expect(alternativeFor("none")).toEqual({ kind: "none" });
  });
});

describe("vanilla readiness reports what the build would", () => {
  const project = (logic: EELogic) => ({ ...starterProject("e", "E"), requires: ["exodus" as const], logic });

  it("agrees with a real vanilla build, error for error", () => {
    const undecided = project(logicWith([lore(null)]));
    const readiness = vanillaReadiness(undecided);
    expect(readiness).toMatchObject({ exodusActions: 1, ready: false });
    let message = "";
    try {
      buildProject(loadCatalog(TARGET_2026), undecided, { sourceHash: "t", mode: "vanilla" });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const problem of readiness.problems) expect(message).toContain(problem.trim());

    let logic = setStepChoice(addStep(logicWith([lore("s")]), "s"), "s", "none");
    expect(vanillaReadiness(project(logic))).toMatchObject({ ready: true, problems: [] });
    logic = setStepEssential(logic, "s", true);
    expect(vanillaReadiness(project(logic)).ready).toBe(false);
  });

  it("a project without EXODUS is trivially ready", () => {
    expect(vanillaReadiness(starterProject("p", "P"))).toMatchObject({ exodusActions: 0, ready: true });
  });
});
