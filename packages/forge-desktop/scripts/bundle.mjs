#!/usr/bin/env node
/**
 * Builds the runnable desktop app into dist/ (no installer: that is increment 6):
 *
 *   dist/main.cjs        Electron main process, with @forge/app, @forge/core, @forge/contracts and zod inside
 *   dist/preload.cjs     the restricted preload
 *   dist/renderer/       the editor (web-forge's production build)
 *   dist/resources/assets/                    stock images and 3D models (read-only)
 *   dist/resources/optional/exodus-extension.mjs   only with --with-exodus-extension
 *   dist/package.json    names the entry, so `electron dist` runs it
 *
 * Nothing in dist/ refers to the developer's folders; `test/bundle.test.ts` checks that.
 * No EmptyEpsilon executable is copied: the app only ever reads an installation the user registers.
 */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildInventory, filterManifest, modelsUsedByForge } from "./asset-inventory.mjs";
import { buildNotices } from "./notices.mjs";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repo = resolve(pkgRoot, "..", "..");
const dist = join(pkgRoot, "dist");
const withExtension = process.argv.includes("--with-exodus-extension");
const skipAssets = process.argv.includes("--skip-assets");

// `--only-extension <file>`: write just the optional EXODUS extension module there (for tests / opt-in installs).
const onlyExtension = process.argv.includes("--only-extension") ? process.argv[process.argv.indexOf("--only-extension") + 1] : null;
if (onlyExtension) {
  await build({
    bundle: true, platform: "node", target: "node22", legalComments: "none", logLevel: "warning",
    entryPoints: [join(repo, "packages", "forge-exodus", "src", "index.ts")],
    outfile: resolve(onlyExtension),
    format: "esm",
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  console.log(`built the optional EXODUS extension module at ${resolve(onlyExtension)}`);
  process.exit(0);
}

const webDist = join(repo, "packages", "web-forge", "dist");
if (!existsSync(join(webDist, "index.html"))) {
  console.error("web-forge is not built: run `pnpm --filter @exodus/web-forge build` first");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

/**
 * The generated API catalogs record, as provenance, where on the developer's machine the engine reference was
 * read from (`/mnt/c/EE_2026/...`). That is a path of this machine, not something an installed app should
 * carry: the bundle keeps the catalog and says which reference it came from, without the path. The files in
 * the repository are not touched.
 */
const anonymiseCatalogs = {
  name: "anonymise-catalog-source",
  setup(b) {
    b.onLoad({ filter: /forge-core[\\/](src|dist)[\\/]catalog[\\/](catalog\.generated|targets[\\/][^\\/]+)\.json$/ }, (args) => {
      const catalog = JSON.parse(readFileSync(args.path, "utf8"));
      if (typeof catalog.source === "string") catalog.source = `script_reference.html of ${catalog.eeVersion}`;
      return { contents: JSON.stringify(catalog), loader: "json" };
    });
  },
};

const common = { bundle: true, platform: "node", target: "node22", legalComments: "none", logLevel: "warning", sourcemap: false, plugins: [anonymiseCatalogs] };

await build({ ...common, entryPoints: [join(pkgRoot, "src/main/main.ts")], outfile: join(dist, "main.cjs"), format: "cjs", external: ["electron"] });
await build({ ...common, entryPoints: [join(pkgRoot, "src/preload/preload.ts")], outfile: join(dist, "preload.cjs"), format: "cjs", external: ["electron"] });

cpSync(webDist, join(dist, "renderer"), { recursive: true });

// Assets: only what the licence inventory allows AND the editor uses (see asset-inventory.mjs). Today that is
// the manifest alone — every stock hull model is withheld — plus whatever a future build is allowed to carry.
const assetsOut = join(dist, "resources", "assets");
mkdirSync(assetsOut, { recursive: true });
const sourceAssets = join(repo, "assets");
const fullManifest = JSON.parse(readFileSync(join(sourceAssets, "manifest.json"), "utf8"));
const inventory = skipAssets ? [] : buildInventory(sourceAssets, modelsUsedByForge(fullManifest));
for (const entry of inventory.filter((e) => e.distribute)) {
  mkdirSync(dirname(join(assetsOut, entry.path)), { recursive: true });
  cpSync(join(sourceAssets, entry.path), join(assetsOut, entry.path));
}
const { manifest: shippedManifest, dropped } = filterManifest(fullManifest, inventory);
writeFileSync(join(assetsOut, "manifest.json"), `${JSON.stringify(shippedManifest, null, 2)}\n`);
console.log(`assets: ${inventory.filter((e) => e.distribute).length} file(s) shipped, ${inventory.filter((e) => !e.distribute).length} withheld, ${dropped.length} manifest entr${dropped.length === 1 ? "y" : "ies"} dropped`);

// Notices (needs the pnpm workspace: licence texts are read from node_modules).
const app0 = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const licensesOut = join(dist, "resources", "licenses");
mkdirSync(licensesOut, { recursive: true });
const notices = buildNotices({ repo, version: app0.version, inventory });
writeFileSync(join(licensesOut, "THIRD-PARTY-NOTICES.txt"), notices.text);
writeFileSync(join(licensesOut, "asset-inventory.json"), `${JSON.stringify(inventory.map(({ path, distribute, license, author, source, reason }) => ({ path, distribute, license, author, source, reason })), null, 2)}\n`);
if (notices.missingLicenseFile.length > 0) console.warn(`note: no licence file inside: ${notices.missingLicenseFile.join(", ")}`);

if (withExtension) {
  await build({
    ...common,
    entryPoints: [join(repo, "packages", "forge-exodus", "src", "index.ts")],
    outfile: join(dist, "resources", "optional", "exodus-extension.mjs"),
    format: "esm",
    // esbuild needs a require shim for any CommonJS pulled in; none is expected, but keep the file self-contained.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
}

const app = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
writeFileSync(
  join(dist, "package.json"),
  `${JSON.stringify({ name: "ee-forge", productName: "EE FORGE", version: app.version, description: app.description, author: app.author, main: "main.cjs", private: true }, null, 2)}\n`,
);
console.log(`built ${dist}${withExtension ? " (with the optional EXODUS extension module)" : ""}`);
