import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ForgeExtension } from "@forge/core";
import { createForgeRouter } from "../src/index.js";
import { cleanup, sandbox } from "./helpers.js";

afterEach(cleanup);

/** A stand-in extension: the app only knows the interface, never the real one. */
const stub: ForgeExtension = {
  id: "exodus",
  label: "stub",
  protocol: "9.9.9",
  capabilities: ["x"],
  owns: (action) => action.kind.startsWith("exodus_"),
  describe: () => ({ capability: "x", hasOutcome: false }),
  scenarioPrelude: () => "-- STUB PRELUDE",
  initStatements: () => "",
  updateStatements: () => "",
  emitAction: (_action, site) => `STUB_CALL(${site.stepId === null ? "nil" : `"${site.stepId}"`})`,
};

function withExodusProject(sb: ReturnType<typeof sandbox>, decided: boolean) {
  sb.services.projects.create({ id: "m", name: "m", description: "" });
  const project = sb.services.projects.get("m");
  sb.services.projects.save("m", {
    ...project,
    requires: ["exodus"],
    logic: {
      ...project.logic,
      beats: [
        {
          id: "b",
          label: "b",
          at: 0,
          actions: [{ kind: "exodus_lore", stepId: decided ? "lore" : null, fragmentId: "f", foundBy: null }],
        },
      ],
      exodusSteps: decided
        ? [{ id: "lore", essential: false, alternative: { kind: "immediate", actions: [{ kind: "banner", text: "found" }] }, answerWithinS: null, onSuccess: [] }]
        : [],
    },
  });
}

describe("a Forge with no extension", () => {
  it("lists none and exports only vanilla", async () => {
    const sb = sandbox();
    const router = createForgeRouter(sb.services);
    expect((await router.handle({ method: "GET", path: "/forge/extensions" })).body).toEqual({ extensions: [] });

    withExodusProject(sb, false);
    const undecided = await router.handle({ method: "POST", path: "/forge/projects/m/build", body: {} });
    expect(undecided.status).toBe(422);
    expect((undecided.body as { error: string }).error).toContain("1 EXODUS step still to complete");
  });

  it("exports a decided mission as vanilla, with nothing of EXODUS in the files", async () => {
    const sb = sandbox();
    withExodusProject(sb, true);
    const built = sb.services.projects.build("m");
    expect(built.mode).toBe("vanilla");
    for (const file of built.files) {
      const text = readFileSync(join(sb.projectsDir, "m", "build", file.name), "utf8");
      expect(text).not.toMatch(/bridge|exodus_bridge|exodus_request/);
    }
  });

  it("refuses an integrated export, naming the missing extension", () => {
    const sb = sandbox();
    withExodusProject(sb, true);
    expect(() => sb.services.projects.build("m", { mode: "integrated" })).toThrow(/no EXODUS extension is registered/);
  });
});

describe("a Forge with an extension registered by its host", () => {
  it("advertises it and builds integrated by default", async () => {
    const sb = sandbox({ extensions: [stub] });
    const router = createForgeRouter(sb.services);
    expect((await router.handle({ method: "GET", path: "/forge/extensions" })).body).toEqual({
      extensions: [
        {
          id: "exodus",
          label: "stub",
          protocol: "9.9.9",
          capabilities: ["x"],
          // The stub recorded no evidence, so every engine is reported unverified — never assumed.
          compatibility: {
            "EE-2024.12.08": { level: "unverified", note: "No evidence recorded for this engine." },
            "EE-2026.09.22PR": { level: "unverified", note: "No evidence recorded for this engine." },
          },
        },
      ],
    });
    withExodusProject(sb, true);
    const built = await router.handle({ method: "POST", path: "/forge/projects/m/build", body: {} });
    expect(built.status).toBe(200);
    expect((built.body as { mode: string }).mode).toBe("integrated");
    const scenario = readFileSync(join(sb.projectsDir, "m", "build", "scenario_m.lua"), "utf8");
    expect(scenario).toContain("STUB_CALL");
    expect(scenario).toContain("-- STUB PRELUDE");
  });

  it("still exports vanilla on request", async () => {
    const sb = sandbox({ extensions: [stub] });
    withExodusProject(sb, true);
    const router = createForgeRouter(sb.services);
    const built = await router.handle({ method: "POST", path: "/forge/projects/m/build", body: { mode: "vanilla" } });
    expect((built.body as { mode: string }).mode).toBe("vanilla");
    expect(readFileSync(join(sb.projectsDir, "m", "build", "scenario_m.lua"), "utf8")).not.toContain("STUB_CALL");
  });
});
