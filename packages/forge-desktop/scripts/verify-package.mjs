#!/usr/bin/env node
/**
 * Checks what the packaged application actually contains — the unpacked tree electron-builder produced, with
 * app.asar opened — against what the product must NOT contain:
 *
 *   - a path of the machine that built it (home folders, the repository, WSL mounts);
 *   - an EmptyEpsilon executable or engine file, an EXODUS file, a test tool (playwright, vitest, esbuild …),
 *     source maps, `node_modules`, e2e fixtures;
 *   - an asset the licence inventory withholds.
 * and for what it must contain: the notices, the inventory, the icon, the renderer, the Electron licence files.
 *
 * Usage: node verify-package.mjs <win-unpacked dir> [--repo <repo root>]
 * Exit code 1 when anything is wrong; prints the findings either way.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function verifyPackage(unpacked, { repo = null } = {}) {
  const problems = [];
  const notes = [];
  const resources = join(unpacked, "resources");
  const asarFile = join(resources, "app.asar");
  if (!existsSync(asarFile)) return { problems: [`no resources/app.asar under ${unpacked}`], notes };

  const asar = require("@electron/asar");
  const staging = mkdtempSync(join(tmpdir(), "forge-verify-"));
  const appDir = join(staging, "app");
  try {
    asar.extractAll(asarFile, appDir);
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(appDir);
    const rel = files.map((f) => relative(appDir, f).split(sep).join("/"));
    notes.push(`app.asar: ${files.length} file(s)`);

    // 1. forbidden names
    const forbiddenName = [
      [/(^|\/)node_modules\//, "node_modules inside the app"],
      [/\.map$/, "source map"],
      [/\.(exe|dll|so|dylib)$/i, "native/executable file inside the app archive"],
      [/(^|\/)(e2e|test|tests)\//, "test folder"],
      [/playwright|vitest|esbuild|electron-builder/i, "build/test tool"],
      [/script_reference|emptyepsilon|exodus_bridge|\.pack$/i, "EmptyEpsilon / EXODUS engine file"],
      [/(^|\/)(src)\//, "source folder"],
    ];
    for (const r of rel) for (const [re, why] of forbiddenName) if (re.test(r)) problems.push(`${r}: ${why}`);

    // 2. developer paths in every text file
    const needles = [/\/home\/[a-z0-9_.-]+\//i, /\/mnt\/[a-z]\//, /C:\\Users\\[A-Za-z0-9_.-]+\\/, /[A-Z]:\\(Users|VSCODE|dev|src)\\/i, /VSCODE\/EXODUS/];
    if (repo !== null) needles.push(new RegExp(resolve(repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const [i, f] of files.entries()) {
      if (!/\.(js|cjs|mjs|json|html|css|txt|md|yml|yaml|lua)$/i.test(f)) continue;
      const text = readFileSync(f, "utf8");
      for (const re of needles) if (re.test(text)) problems.push(`${rel[i]}: contains a developer path (${re.source.slice(0, 40)})`);
    }

    // 3. required content
    for (const need of ["package.json", "main.cjs", "preload.cjs", "renderer/index.html", "resources/assets/manifest.json", "resources/licenses/THIRD-PARTY-NOTICES.txt", "resources/licenses/asset-inventory.json"]) {
      if (!rel.includes(need)) problems.push(`missing from the app: ${need}`);
    }

    // 4. assets: exactly the distributable ones
    const inventoryFile = join(appDir, "resources", "licenses", "asset-inventory.json");
    if (existsSync(inventoryFile)) {
      const inventory = JSON.parse(readFileSync(inventoryFile, "utf8"));
      const allowed = new Set(inventory.filter((e) => e.distribute).map((e) => `resources/assets/${e.path}`));
      for (const r of rel.filter((x) => x.startsWith("resources/assets/") && x !== "resources/assets/manifest.json")) {
        if (!allowed.has(r)) problems.push(`${r}: an asset the licence inventory does not allow`);
      }
      notes.push(`assets shipped: ${[...allowed].length}`);
    }

    // 5. the optional EXODUS module must not be in a default build
    if (rel.some((r) => r.includes("optional/exodus-extension"))) problems.push("the optional EXODUS extension module is inside the product");
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  // Outside the archive: the runtime's own notices and the real executables.
  for (const need of ["LICENSE.electron.txt", "LICENSES.chromium.html", "THIRD-PARTY-NOTICES.txt", "Save backup tool/forge-save-backup.ps1", "Save backup tool/README.txt"]) {
    if (!existsSync(join(unpacked, need))) problems.push(`missing next to the program: ${need}`);
  }
  const exes = readdirSync(unpacked).filter((n) => /\.exe$/i.test(n));
  notes.push(`executables beside the app: ${exes.join(", ")}`);
  for (const exe of exes) if (!/^(EE FORGE)\.exe$/i.test(exe)) problems.push(`unexpected executable: ${exe}`);
  const ee = readdirSync(unpacked, { recursive: true }).map(String).filter((n) => /emptyepsilon/i.test(n));
  if (ee.length > 0) problems.push(`EmptyEpsilon files in the product: ${ee.join(", ")}`);
  return { problems, notes };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: verify-package.mjs <win-unpacked dir> [--repo <root>]");
    process.exit(2);
  }
  const repoFlag = process.argv.indexOf("--repo");
  const { problems, notes } = verifyPackage(resolve(dir), { repo: repoFlag > 0 ? process.argv[repoFlag + 1] : null });
  for (const n of notes) console.log(`  ${n}`);
  for (const p of problems) console.error(`  PROBLEM: ${p}`);
  console.log(problems.length === 0 ? "package content: OK" : `package content: ${problems.length} problem(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
