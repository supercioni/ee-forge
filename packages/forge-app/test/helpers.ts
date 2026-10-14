import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createForgeServices, type ForgeServiceOptions, type ForgeServices } from "../src/index.js";

export const REFERENCE: Record<string, string> = {
  "EE-2024.12.08": "/mnt/c/Win32_EmptyEpsilon_EE-2024.12.08/EmptyEpsilon/script_reference.html",
  "EE-2026.09.22PR": "/mnt/c/EE_2026/EmptyEpsilon/script_reference.html",
};
export const haveReferences = Object.values(REFERENCE).every((file) => existsSync(file));

const dirs: string[] = [];
export function tmp(prefix = "forge-app-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
export function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * A scratch install: only the engine's own `script_reference.html` is copied
 * (so identity detection is real evidence), plus a tiny `resources/` tree.
 * Never touches the real installation.
 */
export function fakeInstall(target: string | null, texture: string): string {
  const dir = tmp("fake-ee-");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "resources", "planets"), { recursive: true });
  writeFileSync(join(dir, "resources", "planets", "shared-name.png"), texture);
  if (target !== null) copyFileSync(REFERENCE[target]!, join(dir, "script_reference.html"));
  return dir;
}

export interface Sandbox {
  readonly services: ForgeServices;
  readonly projectsDir: string;
  readonly bundled: string;
}

export function sandbox(options: Partial<ForgeServiceOptions> = {}): Sandbox {
  const projectsDir = tmp("forge-projects-");
  const bundled = tmp("forge-bundled-");
  writeFileSync(join(bundled, "manifest.json"), "{}");
  mkdirSync(join(bundled, "planets"), { recursive: true });
  writeFileSync(join(bundled, "planets", "shared-name.png"), "BUNDLED");
  const services = createForgeServices({ projectsDir, bundledAssetsDir: bundled, ...options });
  return { services, projectsDir, bundled };
}
