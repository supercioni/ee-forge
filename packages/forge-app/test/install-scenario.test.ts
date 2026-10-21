import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createTemplate } from "@forge/core/editor";
import { cleanup, fakeInstall, haveReferences, sandbox, tmp } from "./helpers.js";

afterEach(cleanup);

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const T26 = "EE-2026.09.22PR";
const T24 = "EE-2024.12.08";

/** The demonstration project imported into a sandbox, with one custom template so the launch-time file exists. */
function projectWithTemplate() {
  const sb = sandbox();
  const dir = tmp("scenario-src-");
  cpSync(join(repo, "projects", "exodus_optional_demo"), dir, { recursive: true });
  const imported = sb.services.projects.importCopy(dir);
  const project = sb.services.projects.get(imported.id);
  return { sb, id: imported.id, project };
}

/** Same, with a custom ship template (which only exists after EE restarts). */
function projectWithHull() {
  const base = projectWithTemplate();
  const project = { ...base.project, templates: [{ ...createTemplate("hull", "Test Hull"), model: "small_frigate_1" }] };
  writeFileSync(join(base.sb.projectsDir, base.id, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  return { ...base, project };
}

describe.skipIf(!haveReferences)("installing a scenario into an EE install", () => {
  it("installs a complete bundle, then reports a re-install as already up to date", () => {
    const { sb, id } = projectWithTemplate();
    const install = fakeInstall(T26, "x");
    const first = sb.services.projects.build(id, { install, patchShipTemplates: true }).install!;
    expect(first.status).toBe("installed");
    expect(first.ok).toBe(true);
    expect(first.installed.length).toBeGreaterThan(0);
    for (const path of first.installed) expect(existsSync(path)).toBe(true);
    const again = sb.services.projects.build(id, { install, patchShipTemplates: true }).install!;
    expect(again.status).toBe("installed");
    expect(again.installed).toEqual([]);
    expect(again.unchanged.length).toBe(first.installed.length);
  });

  it("refuses a target of the other engine before writing anything", () => {
    const { sb, id } = projectWithTemplate();
    const wrong = fakeInstall(T24, "x");
    const before = readdirSync(join(wrong, "scripts"));
    expect(() => sb.services.projects.build(id, { install: wrong })).toThrow(/targets/);
    expect(readdirSync(join(wrong, "scripts"))).toEqual(before);
  });

  it("refuses a file that is not ours, names it, keeps backups outside the install, and replaces it only on request", () => {
    const { sb, id } = projectWithTemplate();
    const install = fakeInstall(T26, "x");
    const mine = join(install, "scripts", `scenario_${id}.lua`);
    writeFileSync(mine, "-- somebody else's file\n");
    const refused = sb.services.projects.build(id, { install }).install!;
    expect(refused.status).toBe("refused");
    expect(refused.ok).toBe(false);
    expect(refused.collisions).toEqual([mine]);
    expect(readFileSync(mine, "utf8")).toBe("-- somebody else's file\n");
    expect(readdirSync(join(install, "scripts")).filter((n) => n.startsWith(id))).toEqual([]); // nothing else was written

    const forced = sb.services.projects.build(id, { install, overwrite: true }).install!;
    expect(forced.status).toBe("installed");
    expect(forced.backupDir).not.toBeNull();
    expect(forced.backupDir!.startsWith(install)).toBe(false); // backups live in the app's state folder
    expect(readFileSync(join(forced.backupDir!, `scenario_${id}.lua`), "utf8")).toBe("-- somebody else's file\n");
  });

  it("says apart which templates and models only exist after EE restarts, and installs them as pending until the require line is in", () => {
    const { sb, id } = projectWithHull();
    const install = fakeInstall(T26, "x");
    const built = sb.services.projects.build(id, {});
    expect(built.launchItems.templates).toEqual(["Test Hull"]);
    expect(built.needsLaunchInstall).toBe(true);

    const noIndex = sb.services.projects.build(id, { install, patchShipTemplates: true }).install!;
    expect(noIndex.status).toBe("installed-pending"); // this install has no shipTemplates.lua to name the file in
    expect(noIndex.warnings.join(" ")).toContain("shipTemplates.lua not found");

    writeFileSync(join(install, "scripts", "shipTemplates.lua"), 'require("shiptemplates/stock.lua")\r\n');
    const pending = sb.services.projects.build(id, { install, patchShipTemplates: false }).install!;
    expect(pending.status).toBe("installed-pending");
    expect(pending.ok).toBe(false);
    expect(pending.restartFiles.length).toBe(0); // unchanged since the previous attempt

    const done = sb.services.projects.build(id, { install, patchShipTemplates: true }).install!;
    expect(done.status).toBe("installed");
    expect(done.needsRestart).toBe(true);
    expect(readFileSync(join(install, "scripts", "shipTemplates.lua"), "utf8")).toContain("\r\nrequire(\"shiptemplates/"); // CRLF kept
    expect(done.backupDir).not.toBeNull();
  });

  it("changing the template and installing again replaces the templates file, never adds a second require line", () => {
    const { sb, id } = projectWithHull();
    const install = fakeInstall(T26, "x");
    writeFileSync(join(install, "scripts", "shipTemplates.lua"), 'require("shiptemplates/stock.lua")\n');
    expect(sb.services.projects.build(id, { install, patchShipTemplates: true }).install!.status).toBe("installed");
    const again = sb.services.projects.build(id, { install, patchShipTemplates: true }).install!;
    expect(again.status).toBe("installed");
    expect(again.needsRestart).toBe(false); // nothing changed: no restart asked
    // the author edits the template; the file Forge wrote is replaced (it is Forge's own, per the ledger), the line stays single
    const edited = sb.services.projects.get(id);
    writeFileSync(join(sb.projectsDir, id, "project.json"), `${JSON.stringify({ ...edited, templates: [{ ...edited.templates[0]!, hull: 4242 }] }, null, 2)}\n`, "utf8");
    const changed = sb.services.projects.build(id, { install, patchShipTemplates: true }).install!;
    expect(changed.status).toBe("installed");
    expect(changed.needsRestart).toBe(true);
    expect(changed.restartFiles.map((f) => f.split(/[\\/]/).pop())).toEqual([`${id}_templates.lua`]);
    const index = readFileSync(join(install, "scripts", "shipTemplates.lua"), "utf8");
    expect(index.split(`require("shiptemplates/${id}_templates.lua")`).length - 1).toBe(1);
    expect(readFileSync(join(install, "scripts", "shiptemplates", `${id}_templates.lua`), "utf8")).toContain("setHull(4242)");
  });

  it("an export says which files are the scenario and which one loads only at launch, with the exact line to add", () => {
    const { sb, id } = projectWithHull();
    const out = tmp("export-notes-");
    const result = sb.services.projects.exportBundle(id, { targets: [T26], mode: "vanilla", outRoot: out });
    const t = result.targets[0]!;
    expect(t.ok).toBe(true);
    expect(t.launchItems.requireLine).toBe(`require("shiptemplates/${id}_templates.lua")`);
    const notes = readFileSync(t.instructionsFile!, "utf8");
    expect(notes).toContain(`scripts/shiptemplates/`);
    expect(notes).toContain(`require("shiptemplates/${id}_templates.lua")`);
    expect(notes).toMatch(/Close EmptyEpsilon completely/);
    expect(notes).toMatch(/restart|start EmptyEpsilon again/i);
    expect(existsSync(join(t.outDir, "scripts", "shiptemplates", `${id}_templates.lua`))).toBe(true);
  });

  it("an export of a scenario without templates is told apart: copy the files, nothing else, no restart", () => {
    const { sb, id } = projectWithTemplate();
    const edited = sb.services.projects.get(id);
    writeFileSync(join(sb.projectsDir, id, "project.json"), `${JSON.stringify({ ...edited, templates: [], models: [] }, null, 2)}\n`, "utf8");
    const t = sb.services.projects.exportBundle(id, { targets: [T24], mode: "vanilla", outRoot: tmp("export-notes-") }).targets[0]!;
    expect(t.needsLaunchInstall).toBe(false);
    expect(t.launchItems.requireLine).toBeNull();
    const notes = readFileSync(t.instructionsFile!, "utf8");
    expect(notes).toMatch(/does not need a restart/);
    expect(notes).not.toContain("require(");
  });
});
