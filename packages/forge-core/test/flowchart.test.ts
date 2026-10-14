import { describe, expect, it } from "vitest";
import { emptyEEProject, type EEProject } from "@forge/contracts";
import { toMermaid } from "../src/editor/flowchart.js";

/**
 * The flowchart is a generated view, so what it must not do is lie about
 * the model or emit something mermaid cannot parse.
 */

function project(): EEProject {
  const base = emptyEEProject("veil", "Veil");
  return {
    ...base,
    map: {
      sectors: [],
      groups: [
        { id: "core", label: "Core", when: "on_start", objects: [] },
        { id: "ambush", label: "Ambush", when: "on_call", objects: [] },
      ],
      markers: [],
    },
    logic: {
      variables: [],
      beats: [
        { id: "arrival", label: "Arrival", at: 0, actions: [{ kind: "banner", text: "Anchorage" }] },
        {
          id: "trap",
          label: "The trap",
          at: 120,
          actions: [
            { kind: "global_message", text: "Contacts!", timeoutS: 5 },
            { kind: "spawn_group", groupId: "ambush" },
          ],
        },
      ],
      rules: [
        {
          id: "cleared",
          label: "Sector cleared",
          when: { kind: "group_destroyed", groupId: "ambush" },
          conditions: [{ kind: "player_hull_below", fraction: 1 }],
          once: true,
          actions: [{ kind: "victory", faction: "Human Navy" }],
        },
      ],
      gmButtons: [
        { id: "force", label: "Force the ambush", actions: [{ kind: "spawn_group", groupId: "ambush" }] },
      ],
    },
  };
}

describe("the generated flowchart", () => {
  it("opens as a mermaid flowchart", () => {
    expect(toMermaid(project()).split("\n")[0]).toBe("flowchart LR");
  });

  it("carries every beat, rule and GM button", () => {
    const chart = toMermaid(project());
    expect(chart).toContain("Arrival");
    expect(chart).toContain("The trap");
    expect(chart).toContain("Sector cleared");
    expect(chart).toContain("GM: Force the ambush");
  });

  it("orders beats by the clock, not by declaration", () => {
    const p = project();
    const shuffled: EEProject = {
      ...p,
      logic: { ...p.logic, beats: [...p.logic.beats].reverse() },
    };
    const chart = toMermaid(shuffled);
    expect(chart.indexOf("T+0s")).toBeLessThan(chart.indexOf("T+120s"));
    // Earlier is not a cause: the clock order is the order of the lines, not an arrow.
    expect(chart).not.toContain("timed_arrival --> timed_trap");
  });

  it("draws who spawns a group, and which rule waits for it to be wiped", () => {
    const chart = toMermaid(project());
    // Two real relations, each stated once: the spawn (timed event and GM control both bring the group in) and the wait.
    expect(chart).toContain("timed_trap -->|spawns| group_ambush");
    expect(chart).toContain("gm_force -->|spawns| group_ambush");
    expect(chart).toContain("group_ambush -.->|wiped| rule_cleared");
  });

  it("shows a rule's guards ANDed with its trigger", () => {
    expect(toMermaid(project())).toContain("group ambush wiped AND player hull < 1");
  });

  it("says once or each time, because re-arming changes the reading", () => {
    const p = project();
    expect(toMermaid(p)).toContain("once: ");
    const repeating: EEProject = {
      ...p,
      logic: { ...p.logic, rules: p.logic.rules.map((r) => ({ ...r, once: false })) },
    };
    expect(toMermaid(repeating)).toContain("each time: ");
  });

  it("survives labels that would break the syntax", () => {
    const p = project();
    const nasty: EEProject = {
      ...p,
      logic: {
        ...p.logic,
        beats: [{ id: "b", label: 'He said "run"\nnow', at: 0, actions: [] }],
      },
    };
    const chart = toMermaid(nasty);
    expect(chart).toContain("He said 'run' now");
    // One node per line: an unescaped newline would split a node in half.
    for (const line of chart.split("\n")) {
      expect((line.match(/"/g) ?? []).length % 2, line).toBe(0);
    }
  });

  it("says so plainly when there is nothing to draw", () => {
    expect(toMermaid(emptyEEProject("p", "P"))).toContain("No timed events, rules or GM controls yet");
  });
});
