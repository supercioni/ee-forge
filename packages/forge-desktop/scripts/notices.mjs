/**
 * THIRD-PARTY-NOTICES for the installer: what is distributed, under which licence, with the licence text.
 *
 * Three parts, each from evidence rather than memory:
 *   1. the production dependency closure of the editor and of the desktop shell (pnpm's own licence listing, with each
 *      package's LICENSE file read from node_modules) — over-inclusive by design: a package that tree-shaking dropped is
 *      still listed, never the other way round;
 *   2. Electron / Chromium, whose notices are shipped as files beside the program (LICENSE.electron.txt and
 *      LICENSES.chromium.html are added by the packager and checked after the build);
 *   3. the bundled assets, from asset-inventory.mjs — each with author, licence and source.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i;

function pnpmLicenses(repo) {
  // When run by pnpm (build script), npm_execpath is pnpm's own entry point: no PATH lookup needed (the Windows
  // build machine has no global pnpm). Otherwise fall back to a `pnpm` on the PATH.
  const entry = process.env.npm_execpath;
  const viaPnpm = entry !== undefined && /pnpm/i.test(entry) && /\.c?js$/.test(entry);
  const pnpmArgs = ["--filter", "@exodus/web-forge", "--filter", "@forge/desktop", "licenses", "list", "--prod", "--json"];
  const run = viaPnpm
    ? spawnSync(process.execPath, [entry, ...pnpmArgs], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    : spawnSync("pnpm", pnpmArgs, { cwd: repo, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`pnpm licenses failed: ${run.stderr || run.stdout}`);
  const byLicense = JSON.parse(run.stdout);
  const packages = [];
  for (const [license, list] of Object.entries(byLicense)) {
    for (const entry of list) {
      // Workspace packages are this product's own code, not third-party.
      if (entry.name.startsWith("@forge/") || entry.name.startsWith("@exodus/")) continue;
      entry.versions.forEach((version, index) => packages.push({ name: entry.name, version, license, author: entry.author ?? null, homepage: entry.homepage ?? null, dir: entry.paths[index] ?? entry.paths[0] }));
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function licenseText(dir) {
  if (!dir || !existsSync(dir)) return null;
  const file = readdirSync(dir).find((name) => LICENSE_FILE.test(name));
  return file === undefined ? null : readFileSync(join(dir, file), "utf8").trim();
}

const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

export function buildNotices({ repo, version, inventory }) {
  const packages = pnpmLicenses(repo);
  const lines = [];
  const rule = "=".repeat(78);
  lines.push(`EE FORGE ${version} — third-party notices`, "", "EE FORGE is made available to you together with the software and data below, each under its own licence.", "The licence of EE FORGE itself is set by its author and is not restated here.", "");
  lines.push(rule, "1. Electron and Chromium", rule, "", "The program runs on Electron (MIT) and Chromium (many licences). Their notices ship as files next to the program:", "  LICENSE.electron.txt, LICENSES.chromium.html", "");
  lines.push(rule, `2. Libraries bundled into the editor and the desktop shell (${packages.length} package versions)`, rule, "");
  const missing = [];
  // The unmodified Apache-2.0 text, taken from a package that ships it, for those that declare Apache-2.0 without a file.
  const apacheText = packages.map((p) => (p.license === "Apache-2.0" ? licenseText(p.dir) : null)).find((t) => t !== null && /TERMS AND CONDITIONS FOR USE, REPRODUCTION/.test(t)) ?? null;
  for (const p of packages) {
    let text = licenseText(p.dir);
    let note = "";
    if (text === null && p.license === "MIT") {
      text = MIT(p.author ?? `the authors of ${p.name}`);
      note = "    (the package ships no licence file: standard MIT text, copyright holder as declared in its package.json)";
    } else if (text === null && p.license === "Apache-2.0" && apacheText !== null) {
      text = apacheText;
      note = "    (the package ships no licence file: the unmodified Apache-2.0 text, taken from another bundled package)";
    }
    lines.push(`--- ${p.name} ${p.version} — ${p.license}${p.author ? ` — ${p.author}` : ""}${p.homepage ? `\n    ${p.homepage}` : ""}`);
    if (note !== "") lines.push(note);
    if (text === null) {
      missing.push(`${p.name}@${p.version}`);
      lines.push(`    (no licence file in the package; declared licence: ${p.license})`);
    } else lines.push("", text);
    lines.push("");
  }
  lines.push(rule, "3. 3D models and images bundled with the app", rule, "");
  const shipped = inventory.filter((e) => e.distribute);
  if (shipped.length === 0) {
    lines.push("No model or image from EmptyEpsilon or from any third-party collection is included.", "The stock EmptyEpsilon images (planet textures, radar traces) are copied by EE FORGE from YOUR EmptyEpsilon", "installation when you register it; 3D hull previews use a generic stand-in drawn by the program.", "");
  } else {
    for (const e of shipped) lines.push(`- ${e.path}: "${e.title}" by ${e.author} — ${e.license} — ${e.source}`);
    lines.push("");
  }
  return { text: lines.join("\n"), packages: packages.length, missingLicenseFile: missing };
}
