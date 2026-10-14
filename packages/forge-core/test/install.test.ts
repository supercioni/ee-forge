import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import { installBuild, previewInstall, requireShipTemplates } from "../src/install.js";
import type { BuildFile } from "../src/codegen/build.js";

/**
 * Installing a build into an EE install.
 *
 * The load-bearing part is `shipTemplates.lua`: it is the one EE-owned
 * file the toolkit writes to, so the patch has to be opt-in, idempotent,
 * and gentle with the CRLF line endings a Windows install has.
 */

let ee: string;
let scripts: string;
let backupRoot: string;

const file = (name: string, install: BuildFile["install"], contents = "-- x\n"): BuildFile => ({
  name,
  contents,
  install,
});

beforeEach(() => {
  ee = mkdtempSync(join(tmpdir(), "ee-install-"));
  scripts = join(ee, "scripts");
  backupRoot = mkdtempSync(join(tmpdir(), "ee-backup-"));
  mkdirSync(join(scripts, "shiptemplates"), { recursive: true });
  writeFileSync(join(scripts, "shipTemplates.lua"), 'require("shiptemplates/corvette.lua")\n');
});

describe("installBuild", () => {
  it("puts a scenario bundle in scripts/ and asks for no restart", () => {
    const result = installBuild(
      ee,
      [file("scenario_demo.lua", "scripts"), file("demo_map.lua", "scripts")],
      (f) => f.contents,
      false,
    );
    expect(result.installed).toHaveLength(2);
    expect(existsSync(join(scripts, "scenario_demo.lua"))).toBe(true);
    expect(result.needsRestart).toBe(false);
    expect(result.requireLine).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("puts templates in shiptemplates/ and says EE must be restarted", () => {
    const result = installBuild(ee, [file("demo_templates.lua", "shiptemplates")], (f) => f.contents, true);
    expect(existsSync(join(scripts, "shiptemplates", "demo_templates.lua"))).toBe(true);
    expect(result.needsRestart).toBe(true);
    expect(result.required).toBe(true);
  });

  it("reports success only for a complete install, and lists the restart files apart", () => {
    const done = installBuild(ee, [file("scenario_demo.lua", "scripts"), file("demo_templates.lua", "shiptemplates")], (f) => f.contents, { patchShipTemplates: false, backupRoot });
    expect(done.status).toBe("installed-pending"); // the templates are in place but nothing names them yet
    expect(done.ok).toBe(false);
    expect(done.restartFiles).toEqual([join(scripts, "shiptemplates", "demo_templates.lua")]);
    expect(done.error).toContain("require");
    const patched = installBuild(ee, [file("scenario_demo.lua", "scripts"), file("demo_templates.lua", "shiptemplates")], (f) => f.contents, { patchShipTemplates: true, backupRoot });
    expect(patched.status).toBe("installed");
    expect(patched.ok).toBe(true);
    expect(patched.unchanged).toHaveLength(2);
    expect(patched.needsRestart).toBe(true); // shipTemplates.lua changed
  });

  it("refuses a file it did not install, touches nothing, and replaces it (with a backup) only on request", () => {
    writeFileSync(join(scripts, "scenario_demo.lua"), "-- the user's own\n");
    const refused = installBuild(ee, [file("scenario_demo.lua", "scripts", "-- ours\n"), file("demo_map.lua", "scripts")], (f) => f.contents, { backupRoot });
    expect(refused.status).toBe("refused");
    expect(refused.ok).toBe(false);
    expect(refused.collisions).toEqual([join(scripts, "scenario_demo.lua")]);
    expect(readFileSync(join(scripts, "scenario_demo.lua"), "utf8")).toBe("-- the user's own\n");
    expect(existsSync(join(scripts, "demo_map.lua"))).toBe(false); // not even the non-colliding file

    const forced = installBuild(ee, [file("scenario_demo.lua", "scripts", "-- ours\n"), file("demo_map.lua", "scripts")], (f) => f.contents, { overwrite: true, backupRoot });
    expect(forced.status).toBe("installed");
    expect(readFileSync(join(scripts, "scenario_demo.lua"), "utf8")).toBe("-- ours\n");
    expect(forced.backupDir).not.toBeNull();
    expect(readFileSync(join(forced.backupDir!, "scenario_demo.lua"), "utf8")).toBe("-- the user's own\n");
  });

  it("updates its own earlier install without asking, and notices when the user edited it since", () => {
    const first = installBuild(ee, [file("scenario_demo.lua", "scripts", "-- v1\n")], (f) => f.contents, { backupRoot });
    expect(first.status).toBe("installed");
    const second = installBuild(ee, [file("scenario_demo.lua", "scripts", "-- v2\n")], (f) => f.contents, { backupRoot });
    expect(second.status).toBe("installed");
    expect(second.collisions).toEqual([]);
    expect(readFileSync(join(second.backupDir!, "scenario_demo.lua"), "utf8")).toBe("-- v1\n");
    writeFileSync(join(scripts, "scenario_demo.lua"), "-- edited by hand\n");
    const third = installBuild(ee, [file("scenario_demo.lua", "scripts", "-- v3\n")], (f) => f.contents, { backupRoot });
    expect(third.status).toBe("refused");
    expect(readFileSync(join(scripts, "scenario_demo.lua"), "utf8")).toBe("-- edited by hand\n");
  });

  it("puts everything back when a write fails part-way, and never says installed", () => {
    writeFileSync(join(scripts, "scenario_demo.lua"), "-- before\n");
    installBuild(ee, [file("scenario_demo.lua", "scripts", "-- before\n")], (f) => f.contents, { backupRoot }); // now "ours"
    const before = readdirSync(scripts).sort();
    let n = 0;
    const result = installBuild(
      ee,
      [file("scenario_demo.lua", "scripts", "-- after\n"), file("demo_map.lua", "scripts"), file("demo_content.lua", "scripts")],
      (f) => f.contents,
      {
        backupRoot,
        patchShipTemplates: true,
        writeFile: (path, contents) => {
          n += 1;
          if (n === 3) throw new Error("EBUSY: resource busy or locked");
          writeFileSync(path, contents);
        },
      },
    );
    expect(result.status).toBe("rolled-back");
    expect(result.ok).toBe(false);
    expect(result.installed).toEqual([]);
    expect(result.error).toContain("EBUSY");
    expect(readFileSync(join(scripts, "scenario_demo.lua"), "utf8")).toBe("-- before\n");
    expect(existsSync(join(scripts, "demo_map.lua"))).toBe(false);
    expect(readdirSync(scripts).sort()).toEqual(before);
  });

  it("flags the one partial state — a rollback that cannot restore — instead of hiding it", () => {
    installBuild(ee, [file("scenario_demo.lua", "scripts", "-- v1\n")], (f) => f.contents, { backupRoot });
    let n = 0;
    const result = installBuild(ee, [file("scenario_demo.lua", "scripts", "-- v2\n"), file("demo_map.lua", "scripts")], (f) => f.contents, {
      backupRoot,
      writeFile: (path, contents) => {
        n += 1;
        if (n === 2) {
          rmSync(backupRoot, { recursive: true, force: true }); // the safety net disappears, then the write fails
          throw new Error("disk full");
        }
        writeFileSync(path, contents);
      },
    });
    expect(result.status).toBe("rollback-failed");
    expect(result.ok).toBe(false);
    expect(result.restore.unrestored).toEqual([join(scripts, "scenario_demo.lua")]);
    expect(result.error).toContain("could not be put back");
    expect(existsSync(join(scripts, "demo_map.lua"))).toBe(false); // what was created is still removed
  });

  it("treats a file that cannot even be read (held open exclusively) as locked, not as a crash", () => {
    // Linux cannot lock a file, so stand in for the read failure with a directory where the file should be:
    // existsSync() is true and readFileSync() throws EISDIR — the same code path as a sharing violation on Windows.
    mkdirSync(join(scripts, "scenario_demo.lua"));
    const result = installBuild(ee, [file("scenario_demo.lua", "scripts", "-- ours\n"), file("demo_map.lua", "scripts")], (f) => f.contents, { backupRoot });
    expect(result.status).toBe("refused");
    expect(result.locked).toEqual([join(scripts, "scenario_demo.lua")]);
    expect(existsSync(join(scripts, "demo_map.lua"))).toBe(false);
  });

  it("refuses an install directory with no scripts/", () => {
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    expect(() => installBuild(bare, [], (f) => f.contents, false)).toThrow(/scripts\//);
  });
});

describe("requireShipTemplates", () => {
  it("does nothing without the opt-in, and says exactly what is missing", () => {
    const result = requireShipTemplates(scripts, "demo_templates.lua", false);
    expect(result.present).toBe(false);
    expect(result.patched).toBe(false);
    expect(result.requireLine).toBe('require("shiptemplates/demo_templates.lua")');
    expect(result.warnings[0]).toContain(result.requireLine);
    expect(readFileSync(join(scripts, "shipTemplates.lua"), "utf8")).not.toContain("demo");
  });

  it("appends the line once, however many times it runs", () => {
    const first = requireShipTemplates(scripts, "demo_templates.lua", true);
    expect(first.patched).toBe(true);
    const second = requireShipTemplates(scripts, "demo_templates.lua", true);
    expect(second.patched).toBe(false);
    expect(second.present).toBe(true);

    const source = readFileSync(join(scripts, "shipTemplates.lua"), "utf8");
    expect(source.split('require("shiptemplates/demo_templates.lua")')).toHaveLength(2);
  });

  it("keeps CRLF, because the install lives on a Windows mount", () => {
    writeFileSync(join(scripts, "shipTemplates.lua"), 'require("shiptemplates/corvette.lua")\r\n');
    requireShipTemplates(scripts, "demo_templates.lua", true);
    const source = readFileSync(join(scripts, "shipTemplates.lua"), "utf8");
    expect(source).toContain("\r\n");
    // Not one stray LF anywhere: a mixed file is a whole-file diff later.
    expect(source.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("says where to put the line when EE's index is missing entirely", () => {
    const bare = mkdtempSync(join(tmpdir(), "noindex-"));
    const result = requireShipTemplates(bare, "demo_templates.lua", true);
    expect(result.present).toBe(false);
    expect(result.warnings[0]).toContain("not found");
  });
});

describe("a failure part-way, when the folder a file belongs in is not a folder", () => {
  it("puts everything back and says rolled-back — not that files could not be put back", () => {
    rmSync(join(scripts, "shiptemplates"), { recursive: true, force: true });
    writeFileSync(join(scripts, "shiptemplates"), "a file where a folder should be\n");
    const before = readdirSync(scripts).sort().join();
    const done = installBuild(ee, [file("scenario_demo.lua", "scripts"), file("demo_templates.lua", "shiptemplates")], (f) => f.contents, { patchShipTemplates: true, backupRoot });
    expect(done.status).toBe("rolled-back");
    expect(done.ok).toBe(false);
    expect(done.restore.unrestored).toEqual([]);
    expect(done.error).toMatch(/every file was put back/);
    expect(readdirSync(scripts).sort().join()).toBe(before);
    expect(existsSync(join(scripts, "scenario_demo.lua"))).toBe(false);
  });
});

describe("previewInstall", () => {
  const bundle = [file("scenario_demo.lua", "scripts"), file("demo_templates.lua", "shiptemplates")];
  const contents = (f: BuildFile): string => f.contents;

  it("says what each file would do, and writes nothing", () => {
    const before = readdirSync(scripts).join();
    const p = previewInstall(ee, bundle, contents, { patchShipTemplates: true });
    expect(p.files.map((f) => f.action)).toEqual(["create", "create"]);
    expect(p.clear).toBe(true);
    expect(p.needsRestart).toBe(true);
    expect(p.requireState).toBe("will-add");
    expect(readdirSync(scripts).join()).toBe(before);
    expect(readFileSync(join(scripts, "shipTemplates.lua"), "utf8")).not.toContain("demo_templates");
  });

  it("calls a file EE FORGE did not install a collision, and a file it did install a replacement", () => {
    writeFileSync(join(scripts, "scenario_demo.lua"), "-- someone else's\n");
    expect(previewInstall(ee, bundle, contents).files[0]).toMatchObject({ action: "collision" });
    expect(previewInstall(ee, bundle, contents).clear).toBe(false);
    installBuild(ee, [file("scenario_demo.lua", "scripts", "-- v1\n")], (f) => f.contents, { overwrite: true, backupRoot });
    const again = previewInstall(ee, [file("scenario_demo.lua", "scripts", "-- v2\n")], contents);
    expect(again.files[0]!.action).toBe("replace");
    expect(again.wouldBackUp).toEqual([join(scripts, "scenario_demo.lua")]);
    expect(again.clear).toBe(true);
  });

  it("calls a file that is already identical unchanged", () => {
    installBuild(ee, [file("scenario_demo.lua", "scripts")], contents, { backupRoot });
    expect(previewInstall(ee, [file("scenario_demo.lua", "scripts")], contents).files[0]!.action).toBe("unchanged");
  });

  it("finds a file that cannot be written (held open) before anything is written", () => {
    installBuild(ee, [file("scenario_demo.lua", "scripts", "-- v1\n")], contents, { backupRoot });
    chmodSync(join(scripts, "scenario_demo.lua"), 0o444);
    try {
      const p = previewInstall(ee, [file("scenario_demo.lua", "scripts", "-- v2\n")], contents);
      if (p.files[0]!.action !== "locked") return; // running as a user who can write anything (root): nothing to show
      expect(p.locked).toEqual([join(scripts, "scenario_demo.lua")]);
      expect(p.clear).toBe(false);
    } finally {
      chmodSync(join(scripts, "scenario_demo.lua"), 0o644);
    }
  });

  it("agrees with the install itself about a collision", () => {
    writeFileSync(join(scripts, "scenario_demo.lua"), "-- someone else's\n");
    const p = previewInstall(ee, bundle, contents);
    const done = installBuild(ee, bundle, contents, { backupRoot });
    expect(done.status).toBe("refused");
    expect(done.collisions).toEqual(p.collisions);
  });
});
