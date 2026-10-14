#!/usr/bin/env node
/**
 * Builds the Windows installer from a workspace whose packages are already built:
 *
 *   node scripts/build-installer.mjs [--version <x.y.z>] [--skip-bundle]
 *
 * 1. scripts/bundle.mjs (the app, the licence-checked assets, the notices);
 * 2. electron-builder → NSIS installer (x64, per-user) in release/;
 * 3. scripts/verify-package.mjs on release/win-unpacked (no developer paths, no EE/EXODUS/test tooling);
 * 4. release/SHA256SUMS.txt and release/build-info.json (version, SHA-256, tool versions).
 *
 * No certificate is used and nothing is uploaded: the installer is UNSIGNED (Windows SmartScreen will warn).
 * Reproducibility: the inputs are pinned (pnpm-lock.yaml, electron-builder exact version, Electron version);
 * `SOURCE_DATE_EPOCH` fixes the timestamps the packager honours. Byte-identical output is not claimed — the NSIS
 * stub and the packager embed no clock only when SOURCE_DATE_EPOCH is set, and that was not proved bit for bit.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackage } from "./verify-package.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(pkgRoot, "release");
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const version = flag("--version") ?? pkg.version;

function run(command, commandArgs, options = {}) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, { cwd: pkgRoot, stdio: "inherit", shell: process.platform === "win32", ...options });
  if (result.status !== 0) {
    console.error(`${command} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (!args.includes("--skip-bundle")) run(process.execPath, [join(pkgRoot, "scripts", "bundle.mjs")]);
rmSync(release, { recursive: true, force: true });

const electronVersion = JSON.parse(readFileSync(join(pkgRoot, "node_modules", "electron", "package.json"), "utf8")).version;
const builderVersion = JSON.parse(readFileSync(join(pkgRoot, "node_modules", "electron-builder", "package.json"), "utf8")).version;

// The stage: the app and nothing else, outside the workspace (see the note in electron-builder.yml).
const stage = mkdtempSync(join(tmpdir(), "forge-stage-"));
cpSync(join(pkgRoot, "dist"), stage, { recursive: true });
cpSync(join(pkgRoot, "build"), join(stage, "build"), { recursive: true });
cpSync(join(pkgRoot, "electron-builder.yml"), join(stage, "electron-builder.yml"));
// The optional campaign-save backup utility: a stage folder that electron-builder copies BESIDE the program (extraFiles), not into app.asar.
cpSync(join(pkgRoot, "resources", "save-backup"), join(stage, "save-backup"), { recursive: true });

const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false", // never look for a signing certificate
  SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "1760000000",
};
const bin = join(pkgRoot, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
run(bin, ["--projectDir", stage, "--config", "electron-builder.yml", "--win", "nsis", "--x64", `-c.electronVersion=${electronVersion}`, `-c.extraMetadata.version=${version}`, `-c.directories.output=${release}`, "--publish", "never"], { env, cwd: stage });
rmSync(stage, { recursive: true, force: true });

const unpacked = join(release, "win-unpacked");
const { problems, notes } = verifyPackage(unpacked, { repo: resolve(pkgRoot, "..", "..") });
for (const n of notes) console.log(`  ${n}`);
if (problems.length > 0) {
  for (const p of problems) console.error(`  PROBLEM: ${p}`);
  console.error("the installer was built but its content check FAILED — do not distribute it");
  process.exit(1);
}
console.log("package content: OK");

const installers = readdirSync(release).filter((n) => /^EE-FORGE-Setup-.*\.exe$/.test(n));
if (installers.length !== 1) {
  console.error(`expected exactly one installer in ${release}, found: ${installers.join(", ") || "none"}`);
  process.exit(1);
}
const installer = join(release, installers[0]);
const sha256 = createHash("sha256").update(readFileSync(installer)).digest("hex");
writeFileSync(join(release, "SHA256SUMS.txt"), `${sha256} *${installers[0]}\n`);
writeFileSync(
  join(release, "build-info.json"),
  `${JSON.stringify({ file: installers[0], version, bytes: statSync(installer).size, sha256, arch: "x64", signed: false, electron: electronVersion, electronBuilder: builderVersion, node: process.version, platform: process.platform, sourceDateEpoch: env.SOURCE_DATE_EPOCH }, null, 2)}\n`,
);
console.log(`\ninstaller: ${installer}\nversion:   ${version}\nsha256:    ${sha256}\nunsigned:  yes (no certificate used)`);
