import { describe, expect, it } from "vitest";
import { useEditor } from "../src/store/editor.js";

describe("picking on the map returns to the view that asked", () => {
  const request = { want: "object", path: { owner: { kind: "rule", id: "r" }, target: { slot: "when" } }, key: "objectId", prompt: "Click it" } as const;

  it("goes to the map, and cancelling comes back to Dialogues, not Mission", () => {
    useEditor.setState({ view: "dialogues", pick: null });
    useEditor.getState().requestPick(request);
    expect(useEditor.getState().view).toBe("map");
    expect(useEditor.getState().pickFrom).toBe("dialogues");
    useEditor.getState().cancelPick();
    expect(useEditor.getState().view).toBe("dialogues");
    expect(useEditor.getState().pick).toBeNull();
  });
  it("comes back to Mission when Mission asked", () => {
    useEditor.setState({ view: "narrative", pick: null });
    useEditor.getState().requestPick(request);
    useEditor.getState().cancelPick();
    expect(useEditor.getState().view).toBe("narrative");
  });
  it("with no pick pending, cancelling leaves the view alone (Esc on the Map stays on the Map)", () => {
    useEditor.setState({ view: "map", pick: null, pickFrom: "narrative" });
    useEditor.getState().cancelPick();
    expect(useEditor.getState().view).toBe("map");
    expect(useEditor.getState().pick).toBeNull();
  });
  it("switching view while picking drops the pick", () => {
    useEditor.setState({ view: "narrative", pick: null });
    useEditor.getState().requestPick(request);
    useEditor.getState().setView("ship");
    expect(useEditor.getState().pick).toBeNull();
    expect(useEditor.getState().view).toBe("ship");
  });
});
