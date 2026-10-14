#!/usr/bin/env node
/**
 * Start the built app from a terminal (development): `pnpm --filter @forge/desktop start`.
 * Clears ELECTRON_RUN_AS_NODE (editors such as VS Code set it, and it turns Electron into plain Node), and on
 * Linux adds --no-sandbox when the packaged chrome-sandbox helper is not set-uid root (the usual case in a
 * checkout). A user of the installed app never needs this: they start it from its icon (increment 6).
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(pkg, "dist");
if (!existsSync(join(dist, "main.cjs"))) {
  console.error("build first: pnpm --filter @exodus/web-forge build && pnpm --filter @forge/desktop build");
  process.exit(1);
}
const binary = join(pkg, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = [dist, ...process.argv.slice(2).filter((a) => a !== "--detach")];
if (process.platform === "linux") {
  const sandbox = join(pkg, "node_modules", "electron", "dist", "chrome-sandbox");
  const setuid = existsSync(sandbox) && (statSync(sandbox).mode & 0o4000) !== 0;
  if (!setuid && !args.includes("--no-sandbox")) args.push("--no-sandbox");
}
// --detach: start the app on its own and return, so the terminal can be closed without closing the app
// (what an icon does; the installed app in increment 6 needs no terminal at all).
const detach = process.argv.includes("--detach");
const child = spawn(binary, args.filter((a) => a !== "--detach"), detach ? { stdio: "ignore", env, detached: true } : { stdio: "inherit", env });
if (detach) {
  child.unref();
  console.log(`EE FORGE started (pid ${child.pid}); you can close this terminal.`);
} else {
  child.on("exit", (code) => process.exit(code ?? 0));
}
