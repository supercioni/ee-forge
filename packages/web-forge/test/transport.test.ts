import { afterEach, describe, expect, it } from "vitest";
import { ForgeApiError, fetchProjects, saveProject } from "../src/api/client.js";
import {
  assetScopeKey,
  assetUrl,
  httpTransport,
  setAssetInstall,
  setAssetTarget,
  setTransport,
  type ForgeTransport,
} from "../src/api/transport.js";

afterEach(() => {
  setTransport(null);
  setAssetTarget(null);
});

/** A transport that records requests and answers from a table: no network, no host, no port. */
function scripted(answers: Record<string, { status: number; body: unknown }>): ForgeTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    label: "scripted",
    calls,
    async send(method, path) {
      calls.push(`${method} ${path}`);
      const answer = answers[`${method} ${path}`];
      if (answer === undefined) throw new Error("unreachable");
      return answer;
    },
    assetUrl: (path, target, install) => `mem://${target ?? "-"}${install === undefined || install === null ? "" : `@${install}`}/${path}`,
  };
}

describe("the editor talks to a transport, not to a host", () => {
  it("uses whatever transport is installed", async () => {
    const t = scripted({ "GET /forge/projects": { status: 200, body: { projects: [], projectsDir: "/p" } } });
    setTransport(t);
    expect(await fetchProjects()).toEqual({ projects: [], projectsDir: "/p" });
    expect(t.calls).toEqual(["GET /forge/projects"]);
  });

  it("turns a service error into a ForgeApiError with its path", async () => {
    setTransport(scripted({ "PUT /forge/projects/x": { status: 400, body: { error: "bad", path: "eeVersion" } } }));
    await expect(saveProject({ id: "x" } as never)).rejects.toMatchObject({ status: 400, path: "eeVersion", message: "bad" });
  });

  it("explains an unreachable service without naming EXODUS", async () => {
    setTransport(scripted({}));
    const error = await fetchProjects().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeApiError);
    expect((error as Error).message).toContain("cannot reach the Forge service (scripted)");
  });

  it("builds asset URLs from the active target through the transport", () => {
    setTransport(scripted({}));
    expect(assetUrl("planets/a.png")).toBe("mem://-/planets/a.png");
    setAssetTarget("EE-2024.12.08");
    expect(assetUrl("planets/a.png")).toBe("mem://EE-2024.12.08/planets/a.png");
  });

  it("names the chosen installation too, and forgets every earlier answer when it changes", () => {
    setTransport(scripted({}));
    setAssetTarget("EE-2026.09.22PR");
    setAssetInstall("inst-b");
    const first = assetScopeKey();
    expect(assetUrl("radar/x.png")).toContain("EE-2026.09.22PR@inst-b/radar/x.png");
    setAssetInstall("inst-a");
    expect(assetUrl("radar/x.png")).toContain("@inst-a/");
    expect(assetScopeKey()).not.toBe(first);
    setAssetInstall(null);
  });

  it("http transport: same origin by default, configurable base, encoded asset paths", () => {
    expect(httpTransport("").assetUrl("nebula/Nebula 2.png", "EE-2026.09.22PR")).toBe(
      "/forge/assets/nebula/Nebula%202.png?target=EE-2026.09.22PR",
    );
    expect(httpTransport("").assetUrl("radar/x.png", "EE-2026.09.22PR", "inst 1")).toBe("/forge/assets/radar/x.png?target=EE-2026.09.22PR&install=inst%201");
    expect(httpTransport("http://forge.test:1234").assetUrl("radar/x.png", null)).toBe(
      "http://forge.test:1234/forge/assets/radar/x.png",
    );
  });
});
