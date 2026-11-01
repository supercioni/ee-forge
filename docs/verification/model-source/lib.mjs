// Real-Electron harness: launches the built desktop app against an ISOLATED userData/documents folder.
import { _electron as electron } from "../../../node_modules/.pnpm/playwright-core@1.64.0/node_modules/playwright-core/index.mjs";
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "../../..");
export const OUT = process.env.OUT ?? join(here, "screens");
mkdirSync(OUT, { recursive: true });

export function sandboxDirs() {
  return { userData: mkdtempSync(join(tmpdir(), "forge-ud-")), documents: mkdtempSync(join(tmpdir(), "forge-docs-")) };
}

export async function launch({ userData, documents }) {
  // A previous instance that was killed leaves Chromium's single-instance lock behind.
  try { for (const f of readdirSync(userData)) if (/^Singleton/.test(f)) rmSync(join(userData, f), { force: true }); } catch { /* none */ }
  const app = await electron.launch({
    executablePath: join(REPO, "packages/forge-desktop/node_modules/.bin/electron"),
    args: [join(REPO, "packages/forge-desktop/dist"), `--user-data-dir=${userData}`, "--no-sandbox", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "", FORGE_DESKTOP_USER_DATA: userData, FORGE_DESKTOP_DOCUMENTS: documents },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  const notFound = [];
  page.on("response", (r) => { if (r.status() === 404) notFound.push(r.url()); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
  return { app, page, errors, notFound, shot: (name) => page.screenshot({ path: join(OUT, name) }), close: async () => {
      // Quit the way a user does so Chromium flushes localStorage; kill only if the app does not exit.
      await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 20000))]);
      try { app.process().kill("SIGKILL"); } catch { /* already gone */ }
      // The playwright handle is the CLI wrapper; Electron itself (identified by this run's private userData folder) must go too.
      try { execSync(`pkill -9 -f -- "--user-data-dir=${userData}"; true`, { shell: "/bin/bash" }); } catch { /* none left */ }
      await new Promise((r) => setTimeout(r, 1500));
    } };
}
