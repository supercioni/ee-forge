import { existsSync } from "node:fs";
import type { ForgeExtension } from "@forge/core";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createForgeHttpServer } from "./http.js";
import { createForgeRouter } from "./router.js";
import { createForgeServices } from "./services.js";

/**
 * `pnpm --filter @forge/app serve -- --projects-dir <dir> [--state-dir <dir>]
 * [--assets-dir <dir>] [--static-dir <dir>] [--port 8092] [--cors <origin>]
 * [--extension <path-or-module>]`
 *
 * Forge in browser mode, with nothing of EXODUS running.
 */
function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

const projectsDir = flag("projects-dir") ?? process.env["FORGE_PROJECTS_DIR"] ?? join(process.cwd(), "projects");
const assetsDir = flag("assets-dir") ?? process.env["FORGE_ASSETS_DIR"] ?? null;
const staticDir = flag("static-dir");
const port = Number(flag("port") ?? process.env["FORGE_PORT"] ?? 8092);
const host = flag("host") ?? "127.0.0.1";

// Extensions are opt-in and named at start-up (`--extension @forge/exodus`): the
// app itself depends on none, so a plain Forge exports vanilla scenarios only.
const extensions: ForgeExtension[] = [];
for (const specifier of process.argv.flatMap((arg, i, all) => (arg === "--extension" ? [all[i + 1] ?? ""] : []))) {
  // A path (./x.js, /abs/x.js) is resolved from the current directory; a bare
  // name must be resolvable from this package.
  const target = /^\.{0,2}\//.test(specifier) ? pathToFileURL(resolve(specifier)).href : specifier;
  const loaded = (await import(target)) as { forgeExtension?: ForgeExtension };
  if (loaded.forgeExtension === undefined) throw new Error(`${specifier} does not export a forgeExtension`);
  extensions.push(loaded.forgeExtension);
}

const services = createForgeServices({
  extensions,
  projectsDir,
  ...(flag("state-dir") !== null ? { stateDir: flag("state-dir")! } : {}),
  bundledAssetsDir: assetsDir !== null && existsSync(assetsDir) ? resolve(assetsDir) : null,
  logger: {
    info: (a, b) => console.log("[forge]", typeof a === "string" ? a : (b ?? ""), typeof a === "string" ? "" : JSON.stringify(a)),
    warn: (a, b) => console.warn("[forge]", typeof a === "string" ? a : (b ?? ""), typeof a === "string" ? "" : JSON.stringify(a)),
    debug: () => undefined,
  },
});

const server = createForgeHttpServer(createForgeRouter(services), {
  staticDir: staticDir === null ? null : resolve(staticDir),
  corsOrigin: flag("cors"),
});
server.listen(port, host, () => {
  console.log(`[forge] listening on http://${host}:${port}  projects=${services.context.projectsDir}  state=${services.context.stateDir}`);
});
