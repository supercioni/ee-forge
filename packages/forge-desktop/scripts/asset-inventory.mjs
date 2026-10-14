#!/usr/bin/env node
/**
 * Decides, file by file, which of the repository's `assets/` may travel inside the installer — and why.
 *
 * The rule is an ALLOWLIST: a file is distributed only when the repository holds positive evidence of a
 * licence that permits redistribution with attribution:
 *   - a glTF whose own `asset.extras.license` (written by the source site's exporter) is CC0 or CC-BY (3.0/4.0);
 *   - the Kenney Space Kit model, CC0, whose terms are kept in `assets/LICENSE-kenney.txt`.
 * Everything else — EmptyEpsilon-derived meshes and images, files with no provenance, anything under a
 * non-commercial / no-derivatives / share-alike licence — is NOT distributed. Nothing is "assumed fine".
 * The stock EmptyEpsilon images (planets, radar traces, nebulae) are obtained from the user's own install
 * (Rescan copies them into the per-install cache); stock 3D hulls are not available offline and the editor
 * shows a labelled generic stand-in.
 *
 * Usage:  node asset-inventory.mjs --write     (refreshes docs/licenses/asset-inventory.json)
 * Import: `buildInventory(assetsDir)` — used by bundle.mjs so the installer can never drift from this rule.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");

/** Licences that allow redistribution with attribution, no NC/ND/SA strings attached. */
const ALLOWED = [
  { id: "CC0-1.0", test: /^CC0/i },
  { id: "CC-BY-4.0", test: /^CC-BY-4\.0\b/i },
  { id: "CC-BY-3.0", test: /^CC-BY-3\.0\b/i },
];

/** Files that are documentation / bookkeeping, never shipped as assets (their content goes into the notices). */
const NOT_ASSETS = new Set(["README.md", ".gitkeep", "LICENSE-kenney.txt", "manifest.json"]);

/** Kenney Space Kit 2.0 (CC0): the licence file in the repository names the pack; ADR-0020 and the changelog record the file. */
const KENNEY = {
  "ships/atlantis.glb": {
    license: "CC0-1.0",
    author: "Kenney (www.kenney.nl)",
    title: "Space Kit 2.0 — craft_speederA",
    source: "https://kenney.nl/assets/space-kit",
    evidence: "assets/LICENSE-kenney.txt (CC0 1.0), docs/adr/0020-asset-pipeline-runtime.md",
  },
};

function glbExtras(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) return null;
  const length = bytes.readUInt32LE(12);
  try {
    const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
    return { extras: json.asset?.extras ?? {}, generator: json.asset?.generator ?? null };
  } catch {
    return null;
  }
}

function reasonNotShipped(path, glb) {
  const top = path.split("/")[0];
  if (top === "ee-ships") {
    return "converted from EmptyEpsilon: the Angryfly pack (TurboSquid Royalty-Free) and msgamedev packs (CGTrader) may only be redistributed whole, unmodified, with EmptyEpsilon itself; the remaining meshes carry no licence in this repository";
  }
  if (glb !== null && typeof glb.extras.license === "string") {
    return `licence "${glb.extras.license}" does not allow redistribution under this policy (non-commercial, no-derivatives or share-alike)`;
  }
  if (["planets", "radar", "nebula", "fx"].includes(top) || path.startsWith("Nebula/")) {
    return "EmptyEpsilon resource whose upstream licence is not established in this repository; taken from the user's own install (Rescan) instead";
  }
  return "no licence or provenance recorded in the file or the repository";
}

/** Manifest keys the Forge editor can resolve to a hull preview (everything else in the manifest is viewer-only). */
const FORGE_KEYS = /^(CpuShip|PlayerSpaceship|SpaceStation):/;

/** Models the Forge editor can actually ask for, from the repository manifest. */
export function modelsUsedByForge(manifest) {
  return new Set(Object.entries(manifest).filter(([key, v]) => FORGE_KEYS.test(key) && v && typeof v.model === "string").map(([, v]) => v.model));
}

/**
 * `used` (optional): the set of model paths the editor references. A licensed file the editor never asks for is
 * not shipped either — less to attribute, less to carry.
 */
export function buildInventory(assetsDir, used = null) {
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const path = relative(assetsDir, full).split(sep).join("/");
      if (NOT_ASSETS.has(name)) continue;
      const bytes = readFileSync(full);
      const glb = name.toLowerCase().endsWith(".glb") ? glbExtras(bytes) : null;
      const base = { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      const kenney = KENNEY[path];
      if (kenney !== undefined) {
        entries.push({ ...base, distribute: true, license: kenney.license, author: kenney.author, title: kenney.title, source: kenney.source, evidence: kenney.evidence, reason: null });
        continue;
      }
      const license = glb !== null && typeof glb.extras.license === "string" ? glb.extras.license : null;
      // Meshes converted from EmptyEpsilon are never shipped, whatever a metadata string says: the packs they came from
      // forbid redistribution outside the original packs (see reasonNotShipped).
      const allowed = license === null || path.split("/")[0] === "ee-ships" ? undefined : ALLOWED.find((a) => a.test.test(license));
      if (allowed !== undefined) {
        entries.push({
          ...base,
          distribute: true,
          license: allowed.id,
          author: String(glb.extras.author ?? "unknown"),
          title: String(glb.extras.title ?? path),
          source: String(glb.extras.source ?? ""),
          evidence: "glTF asset.extras written by the source site's exporter (not re-verified at the source)",
          reason: null,
        });
        continue;
      }
      entries.push({ ...base, distribute: false, license, author: glb?.extras.author ?? null, title: glb?.extras.title ?? null, source: glb?.extras.source ?? null, evidence: null, reason: reasonNotShipped(path, glb) });
    }
  };
  walk(assetsDir);
  if (used === null) return entries;
  return entries.map((e) =>
    e.distribute && !used.has(e.path)
      ? { ...e, distribute: false, reason: `licence allows redistribution (${e.license}), but the Forge editor never loads this file (it belongs to the 3D viewer)` }
      : e,
  );
}

/** The asset manifest with every entry whose model is not distributed removed. */
export function filterManifest(manifest, entries) {
  const shipped = new Set(entries.filter((e) => e.distribute).map((e) => e.path));
  const kept = {};
  const dropped = [];
  for (const [key, value] of Object.entries(manifest)) {
    if (value && typeof value === "object" && typeof value.model === "string" && !shipped.has(value.model)) dropped.push(key);
    else kept[key] = value;
  }
  return { manifest: kept, dropped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(join(repo, "assets", "manifest.json"), "utf8"));
  const entries = buildInventory(join(repo, "assets"), modelsUsedByForge(manifest));
  const summary = {
    total: entries.length,
    distributed: entries.filter((e) => e.distribute).length,
    withheld: entries.filter((e) => !e.distribute).length,
    bytesDistributed: entries.filter((e) => e.distribute).reduce((n, e) => n + e.bytes, 0),
    bytesWithheld: entries.filter((e) => !e.distribute).reduce((n, e) => n + e.bytes, 0),
  };
  console.log(JSON.stringify(summary));
  if (process.argv.includes("--write")) {
    writeFileSync(join(repo, "docs", "licenses", "asset-inventory.json"), `${JSON.stringify({ policy: "allowlist: positive licence evidence only", summary, files: entries }, null, 2)}\n`);
    console.log("wrote docs/licenses/asset-inventory.json");
  }
}
