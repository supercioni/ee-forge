#!/usr/bin/env node
/**
 * Build a Forge project document to its Lua files and write them straight into an ISOLATED EmptyEpsilon clone's scripts folder.
 * For exploration and for the "before the fix" evidence only; the proof runs install through the app's Install dialog
 * (packages/forge-desktop/e2e/collaudo/run-jump-install.mjs), which is the transactional path.
 *
 *   node scripts/sectors/build-into.mjs <project-dir> <clone-dir> [--copy-to <dir>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const core = await import(join(root, "packages/forge-core/dist/index.js"));
const [projectDir, clone] = process.argv.slice(2);
const copyTo = process.argv.includes("--copy-to") ? process.argv[process.argv.indexOf("--copy-to") + 1] : null;
const { project } = core.importProject(JSON.parse(readFileSync(join(projectDir, "project.json"), "utf8")));
const built = core.buildProject(core.loadCatalog(project.eeVersion), project, { sourceHash: "exploration" });
for (const f of built.files) {
  writeFileSync(join(clone, "scripts", f.name), f.contents);
  if (copyTo) { mkdirSync(copyTo, { recursive: true }); writeFileSync(join(copyTo, f.name), f.contents); }
  console.log(`wrote scripts/${f.name}`);
}
for (const w of built.warnings) console.log(`warning: ${w}`);
